import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { FileChange, TreeEntry } from "../shared/model.js";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const ignored = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".gitkeep",
  ".cache",
  ".next",
  ".project-ide",
  ".agents",
  ".codex",
]);
export function allowedEntry(name: string) {
  return (
    !Object.prototype.hasOwnProperty.call(Object.prototype, name) &&
    !ignored.has(name) &&
    (!name.startsWith(".") || name === ".gitignore") &&
    !/(^|[._-])(secrets?|credentials?)([._-]|$)/i.test(name) &&
    !/\.(pem|key|p12|pfx|keystore)$/i.test(name) &&
    !/^(id_rsa|id_ed25519|env)(\.|$)/i.test(name)
  );
}
export function relativeParts(relative: string) {
  if (!relative || path.isAbsolute(relative) || /[\\\x00-\x1f:]/.test(relative))
    throw new AppError("Unsafe file path.");
  const parts = relative.split("/");
  if (
    parts.some(
      (p) =>
        !p || p === "." || p === ".." || p.endsWith(" ") || p.endsWith(".") ||
        (process.platform === "win32" && (/[<>"|?*]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))),
    )
  )
    throw new AppError("Unsafe file path.");
  return parts;
}
export async function checkedPath(
  root: string,
  relative: string,
  project = false,
) {
  const parts = relativeParts(relative);
  if (project && parts.some((p) => !allowedEntry(p)))
    throw new AppError("This file is excluded from project access.");
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new AppError("Unsafe root: expected a real directory.");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (
      stat &&
      (stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (stat.isFile() && stat.nlink !== 1))
    )
      throw new AppError("Links and special files are not permitted.");
    if (stat && i < parts.length - 1 && !stat.isDirectory())
      throw new AppError("Invalid parent directory.");
  }
  return current;
}
export async function readSafe(
  root: string,
  relative: string,
  project = false,
  limit = 1024 * 1024,
) {
  const file = await checkedPath(root, relative, project);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw new AppError("File must be a regular file without links.");
    if (stat.size > limit)
      throw new AppError(
        `File must be a regular file under ${Math.round(limit / 1024)} KB.`,
      );
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
export async function atomicWrite(
  root: string,
  relative: string,
  content: string | Buffer,
  project = false,
) {
  const target = await checkedPath(root, relative, project);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await checkedPath(root, relative, project);
  const temp = path.join(path.dirname(target), `.studio-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export async function ensureRoot(root: string) {
  await fs.mkdir(root, { recursive: true });
  if (
    (await fs.lstat(root)).isSymbolicLink() ||
    !(await fs.lstat(root)).isDirectory()
  )
    throw new AppError("Root directories cannot be links.");
}
export type Manifest = Record<string, Buffer>;
export async function manifest(root: string, excludeRoot: string[] = []): Promise<Manifest> {
  const result: Manifest = {};
  let bytes = 0;
  await ensureRoot(root);
  async function walk(dir = "", depth = 0) {
    if (depth > 20)
      throw new AppError("Project directories are too deeply nested.");
    const entries = await fs.readdir(path.join(root, dir), {
      withFileTypes: true,
    });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!allowedEntry(e.name) || (!dir && excludeRoot.includes(e.name))) continue;
      const relative = dir ? `${dir}/${e.name}` : e.name;
      await checkedPath(root, relative, true);
      if (e.isDirectory()) await walk(relative, depth + 1);
      else {
        result[relative] = await readSafe(root, relative, true);
        bytes += result[relative].length;
        if (bytes > 20 * 1024 * 1024 || Object.keys(result).length > 1500)
          throw new AppError(
            "Project exceeds the MVP limit (1,500 files / 20 MB).",
          );
      }
    }
  }
  await walk();
  return result;
}
export function manifestHash(files: Manifest) {
  return hash(
    Object.keys(files)
      .sort()
      .map((p) => `${p}:${hash(files[p])}`)
      .join("\n"),
  );
}
export async function copyManifest(files: Manifest, to: string) {
  await ensureRoot(to);
  for (const [p, data] of Object.entries(files))
    await atomicWrite(to, p, data, true);
}
export function fileTree(files: Manifest): TreeEntry[] {
  const root: TreeEntry[] = [];
  for (const p of Object.keys(files).sort()) {
    let list = root;
    const parts = p.split("/");
    parts.forEach((name, i) => {
      const relative = parts.slice(0, i + 1).join("/");
      let entry = list.find((e) => e.path === relative);
      if (!entry) {
        entry = {
          path: relative,
          name,
          type: i === parts.length - 1 ? "file" : "directory",
          ...(i < parts.length - 1 ? { children: [] } : {}),
        };
        list.push(entry);
      }
      if (entry.children) list = entry.children;
    });
  }
  const sort = (list: TreeEntry[]) => {
    list.sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type === "directory"
          ? -1
          : 1,
    );
    list.forEach((e) => e.children && sort(e.children));
  };
  sort(root);
  return root;
}
export function isBinary(b: Buffer) {
  return b.includes(0) || !Buffer.from(b.toString("utf8")).equals(b);
}
export function changes(before: Manifest, after: Manifest): FileChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap((p) => {
      const a = before[p],
        b = after[p];
      if (a && b && a.equals(b)) return [];
      const binary = !!((a && isBinary(a)) || (b && isBinary(b)));
      const left = a?.toString("utf8") ?? null,
        right = b?.toString("utf8") ?? null;
      // Full-file unified hunks preserve every changed line without hiding context.
      const lines = (s: string | null) =>
        s === null || s === "" ? [] : s.split("\n");
      const al = lines(left),
        bl = lines(right);
      return [
        {
          path: p,
          kind: !a ? "added" : !b ? "deleted" : "modified",
          beforeHash: a ? hash(a) : null,
          afterHash: b ? hash(b) : null,
          before: binary ? null : left,
          after: binary ? null : right,
          binary,
          diff: binary
            ? "Binary file changed. Source preview unavailable."
            : `--- ${a ? "a/" + p : "/dev/null"}\n+++ ${b ? "b/" + p : "/dev/null"}\n@@ -${al.length ? 1 : 0},${al.length} +${bl.length ? 1 : 0},${bl.length} @@\n${al
                .map((l) => "-" + l)
                .concat(bl.map((l) => "+" + l))
                .join("\n")}`,
        },
      ];
    });
}
