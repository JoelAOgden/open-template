import path from "node:path";
import type {
  DefinitionDiff,
  PlanningContext,
  Snapshot,
} from "../shared/model.js";
import { isBinary, type Manifest } from "./files.js";
import { describeChange } from "./change-summary.js";

type Line = { tag: " " | "+" | "-"; text: string };

// Exact line changes with three lines of context. Bound the LCS work for large
// rewrites; the fallback replaces the changed middle without losing any edits.
export function definitionPatch(
  file: string,
  before: string | null,
  after: string | null,
) {
  const lines = (text: string | null) =>
    text ? text.replace(/\n$/, "").split("\n") : [];
  const a = lines(before),
    b = lines(after);
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const left = a.slice(prefix, a.length - suffix),
    right = b.slice(prefix, b.length - suffix);
  const ops: Line[] = a.slice(0, prefix).map((text) => ({ tag: " ", text }));
  if ((left.length + 1) * (right.length + 1) <= 1_000_000) {
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--)
        table[i * width + j] =
          left[i] === right[j]
            ? 1 + table[(i + 1) * width + j + 1]
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        ops.push({ tag: " ", text: left[i++] });
        j++;
      } else if (
        i < left.length &&
        (j === right.length ||
          table[(i + 1) * width + j] >= table[i * width + j + 1])
      ) {
        ops.push({ tag: "-", text: left[i++] });
      } else ops.push({ tag: "+", text: right[j++] });
    }
  } else {
    for (const text of left) ops.push({ tag: "-", text });
    for (const text of right) ops.push({ tag: "+", text });
  }
  for (const text of a.slice(a.length - suffix)) ops.push({ tag: " ", text });
  const ranges: { start: number; end: number }[] = [];
  ops.forEach((op, index) => {
    if (op.tag === " ") return;
    const start = Math.max(0, index - 3),
      end = Math.min(ops.length, index + 4);
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  });
  const oldLines = [0],
    newLines = [0];
  for (const op of ops) {
    oldLines.push(oldLines.at(-1)! + (op.tag === "+" ? 0 : 1));
    newLines.push(newLines.at(-1)! + (op.tag === "-" ? 0 : 1));
  }
  const hunks = ranges.map(({ start, end }) => {
    const oldCount = oldLines[end] - oldLines[start],
      newCount = newLines[end] - newLines[start];
    return `@@ -${oldLines[start] + (oldCount ? 1 : 0)},${oldCount} +${newLines[start] + (newCount ? 1 : 0)},${newCount} @@\n${ops
      .slice(start, end)
      .map((op) => op.tag + op.text)
      .join("\n")}`;
  });
  return [
    `--- ${before === null ? "/dev/null" : `a/${file}`}`,
    `+++ ${after === null ? "/dev/null" : `b/${file}`}`,
    ...hunks,
  ].join("\n");
}

function definitionFiles(snapshot: Snapshot | null) {
  const files = new Map<
    string,
    { content: string; sectionId?: string; documentId?: string }
  >();
  if (!snapshot) return files;
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  files.set("project.json", { content: json({ name: snapshot.project.name }) });
  for (const section of snapshot.project.sections) {
    files.set(`sections/${section.id}.json`, {
      sectionId: section.id,
      content: json({
        name: section.displayName,
        slug: section.slug,
        skill: section.skillId,
      }),
    });
    files.set(`skills/${section.slug}/SKILL.md`, {
      sectionId: section.id,
      content: (snapshot.skills[section.slug] ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\n*$/, "\n"),
    });
  }
  for (const doc of snapshot.project.documents) {
    files.set(`documents/${doc.id}.json`, {
      sectionId: doc.sectionId,
      documentId: doc.id,
      // Save versions and node IDs are bookkeeping, not requirement changes.
      content: json({
        sectionId: doc.sectionId,
        title: doc.title,
        nodes: doc.nodes.map(({ id: _id, ...node }) => node),
      }),
    });
  }
  return files;
}

export function definitionDiff(
  before: Snapshot | null,
  after: Snapshot,
): DefinitionDiff {
  const oldFiles = definitionFiles(before),
    newFiles = definitionFiles(after);
  return {
    baseSnapshotHash: before?.hash ?? null,
    candidateSnapshotHash: after.hash,
    changes: [...new Set([...oldFiles.keys(), ...newFiles.keys()])]
      .sort()
      .flatMap((file) => {
        const old = oldFiles.get(file),
          current = newFiles.get(file);
        if (old?.content === current?.content) return [];
        const kind = !old ? "added" : !current ? "deleted" : "modified";
        const sectionId = current?.sectionId ?? old?.sectionId;
        const documentId = current?.documentId ?? old?.documentId;
        return [
          {
            path: file,
            kind,
            sectionId,
            documentId,
            summary: describeChange(
              file,
              kind,
              before,
              after,
              sectionId,
              documentId,
              true,
            ),
            description: describeChange(
              file,
              kind,
              before,
              after,
              sectionId,
              documentId,
            ),
            diff: definitionPatch(
              file,
              old?.content ?? null,
              current?.content ?? null,
            ),
          },
        ];
      }),
  };
}

const stopWords = new Set(
  "the and for with this that from have should will when then into only all false true null text title nodes type sectionid bold italic color default added modified deleted documents sections skills json file files user users app project feature features design architecture testing change changes content requirements".split(
    " ",
  ),
);
const words = (text: string) =>
  [...new Set(text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])].filter(
    (word) => !stopWords.has(word) && !/^[a-f0-9]{8,}$/.test(word),
  );

export function planningContext(
  diff: DefinitionDiff,
  snapshot: Snapshot,
  files: Manifest,
  discussion = "",
): PlanningContext {
  const changed =
    diff.changes.map((change) => change.diff).join("\n") + "\n" + discussion;
  const lowerChanges = changed.toLowerCase();
  const references = new Set(
    lowerChanges.match(/[a-z0-9_@.-]+(?:\/[a-z0-9_@.-]+)*\.[a-z0-9]+/g) ?? [],
  );
  const sections = new Set(
    diff.changes.flatMap((change) =>
      change.sectionId ? [change.sectionId] : [],
    ),
  );
  for (const section of snapshot.project.sections)
    if (
      ["architecture", "testing"].includes(section.slug) ||
      lowerChanges.includes(section.displayName.toLowerCase())
    )
      sections.add(section.id);
  // Paths are matched explicitly above; words such as "src" and "tsx" would
  // otherwise make unrelated files look relevant just because of their location.
  const terms = words(
    changed.replace(/[a-z0-9_@.-]+(?:\/[a-z0-9_@.-]+)*\.[a-z0-9]+/gi, " "),
  ).slice(0, 128);
  const docs = snapshot.project.documents.filter((doc) => {
    const section = snapshot.project.sections.find(
      (s) => s.id === doc.sectionId,
    )!;
    return (
      sections.has(doc.sectionId) ||
      (doc.nodes.length > 0 &&
        (["architecture", "testing"].includes(section.slug) ||
          lowerChanges.includes(doc.title.toLowerCase())))
    );
  });
  for (const doc of docs) sections.add(doc.sectionId);
  const slugs = snapshot.project.sections
    .filter((section) => sections.has(section.id))
    .map((section) => section.slug);
  const projectFiles = Object.keys(files).sort();
  const candidates = projectFiles.map((file) => {
    const lower = file.toLowerCase(),
      name = path.posix.basename(lower);
    const content = isBinary(files[file]) ? null : files[file].toString();
    const source = new Set(
      words(
        content?.slice(0, 64_000).replace(/([a-z0-9])([A-Z])/g, "$1 $2") ?? "",
      ),
    );
    const mentioned = references.has(lower) || references.has(name);
    const matches = terms.filter((term) => source.has(term));
    let score = mentioned ? 100 : 0;
    score +=
      terms.filter((term) => lower.includes(term)).length * 8 +
      Math.min(matches.length, 12);
    if (file === "package.json") score += 20;
    if (/^(app|main|index|server)\.[cm]?[jt]sx?$/.test(name)) score += 4;
    if (
      slugs.includes("design") &&
      /\.(css|scss|sass|less|tsx|jsx|html|vue|svelte)$/.test(lower)
    )
      score += 3;
    if (
      slugs.includes("testing") &&
      /(^|[/.])(test|tests|spec)([/.]|$)/.test(lower)
    )
      score += 3;
    return {
      path: file,
      content,
      score,
      reason: mentioned
        ? "Referenced in the diff"
        : file === "package.json"
          ? "Project configuration"
          : matches.length
            ? `Matches: ${matches.slice(0, 4).join(", ")}`
            : "Section context",
    };
  });
  // Include local dependencies and consumers of the strongest matches. Resolve
  // only against the already-filtered manifest, never arbitrary host paths.
  const seeds = new Set(
    candidates
      .filter((file) => file.score >= 8)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, 6)
      .map((file) => file.path),
  );
  const byPath = new Map(candidates.map((file) => [file.path, file]));
  for (const file of candidates) {
    for (const match of (file.content ?? "").matchAll(
      /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](\.[^"']+)["']/g,
    )) {
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.path), match[1]),
      );
      const base = target.replace(/\.[cm]?jsx?$/, "");
      const resolved = [
        target,
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mjs",
          ".css",
          "/index.ts",
          "/index.tsx",
          "/index.js",
        ].map((ext) => base + ext),
      ].find((name) => Object.hasOwn(files, name));
      if (!resolved) continue;
      const related = seeds.has(file.path)
        ? byPath.get(resolved)
        : seeds.has(resolved)
          ? file
          : undefined;
      if (related && !seeds.has(related.path)) {
        related.score += 8;
        related.reason = `Related import: ${seeds.has(file.path) ? file.path : resolved}`;
      }
    }
  }
  let budget = 48_000;
  const selected = candidates
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 12)
    .map((file) => {
      const length = Math.min(budget, 8_000);
      const content =
        file.content === null ? null : file.content.slice(0, length);
      budget -= content?.length ?? 0;
      return {
        path: file.path,
        reason: file.reason,
        content,
        truncated:
          file.content !== null && content!.length < file.content.length,
      };
    });
  return {
    definitionDiff: diff,
    sectionIds: [...sections].filter((id) =>
      snapshot.project.sections.some((section) => section.id === id),
    ),
    documentIds: docs.map((doc) => doc.id),
    projectFiles,
    files: selected,
  };
}
