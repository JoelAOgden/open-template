import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IMAGE_EXTENSIONS, TEXT_EXTENSIONS, importNameKey } from "../shared/imports.js";
import type { DocNode } from "../shared/model.js";
import { AppError, hash } from "./files.js";

export const ImportSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("section"), id: z.string().uuid() }).strict(),
      z
        .object({
          kind: z.literal("document"),
          id: z.string().uuid(),
          version: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    files: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(200)
              .refine(
                (name) =>
                  name.trim().length > 0 &&
                  !/[\\/\u0000-\u001f\u007f]/.test(name) &&
                  name !== "." &&
                  name !== "..",
                "Use a filename without a path.",
              ),
            base64: z.string(),
            resolution: z.discriminatedUnion("action", [
              z.object({
                action: z.literal("replace"),
                documentId: z.string().uuid(),
                version: z.number().int().nonnegative(),
              }).strict(),
              z.object({ action: z.literal("keep_both") }).strict(),
            ]).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export function availableImportName(name: string, used: Set<string>) {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot < 100 ? name.slice(dot) : "";
  const stem = extension ? name.slice(0, dot) : name;
  let candidate = name;
  for (let index = 2; used.has(importNameKey(candidate)); index++) {
    const suffix = ` (${index})`;
    let prefix = stem.slice(0, 200 - suffix.length - extension.length);
    if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
    candidate = `${prefix}${suffix}${extension}`;
  }
  used.add(importNameKey(candidate));
  return candidate;
}

function decodeText(data: Buffer) {
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? "utf-16le"
      : data[0] === 0xfe && data[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding, { fatal: true }).decode(data);
}

// Sniff the XML root, including common editor-exported prologs. This detects
// the image format; it does not parse entities or execute SVG markup. SVGs are
// displayed only through <img>, never inserted into the Studio DOM.
function isSvg(data: Buffer) {
  let source: string;
  try {
    source = decodeText(data);
  } catch {
    return false;
  }
  let offset = 0;
  while (offset < source.length) {
    while (/\s/.test(source[offset] ?? "")) offset++;
    const endToken = source.startsWith("<?", offset)
      ? "?>"
      : source.startsWith("<!--", offset)
        ? "-->"
        : null;
    if (endToken) {
      const end = source.indexOf(endToken, offset + 2);
      if (end < 0) return false;
      offset = end + endToken.length;
      continue;
    }
    if (source.startsWith("<!DOCTYPE", offset)) {
      let quote = "",
        depth = 0;
      for (offset += 9; offset < source.length; offset++) {
        const char = source[offset];
        if (quote) {
          if (char === quote) quote = "";
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "[") depth++;
        else if (char === "]") depth--;
        else if (char === ">" && depth === 0) break;
      }
      offset++;
      continue;
    }
    return /^<svg(?=[\s/>])/.test(source.slice(offset));
  }
  return false;
}

export function imageExtension(data: Buffer) {
  if (data.length >= 12) {
    if (
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return "png";
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "jpg";
    if (/^GIF8[79]a/.test(data.subarray(0, 6).toString())) return "gif";
    if (
      data.subarray(0, 4).toString() === "RIFF" &&
      data.subarray(8, 12).toString() === "WEBP"
    )
      return "webp";
  }
  return isSvg(data) ? "svg" : null;
}

export function prepareImports(files: z.infer<typeof ImportSchema>["files"]) {
  return files.map((file) => {
    const fail = (message: string): never => {
      throw new AppError(`${file.name}: ${message}`);
    };
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))
      fail("Invalid file encoding.");
    const data = Buffer.from(file.base64, "base64");
    if (data.toString("base64") !== file.base64) fail("Invalid file encoding.");
    const ext = file.name.includes(".")
      ? file.name.split(".").at(-1)!.toLowerCase()
      : "";
    const image = imageExtension(data);
    if (image) {
      const assetId = `${hash(data)}.${image}`;
      return {
        name: file.name,
        nodes: [
          { id: randomUUID(), type: "image", assetId, alt: file.name },
        ] as DocNode[],
        asset: { id: assetId, data },
      };
    }
    if (IMAGE_EXTENSIONS.includes(ext))
      fail("Invalid image. Use PNG, JPEG, GIF, WebP or SVG.");
    if (ext && !TEXT_EXTENSIONS.includes(ext))
      fail(
        "Unsupported file type. Use a text file or PNG, JPEG, GIF, WebP or SVG.",
      );
    let text: string;
    try {
      text = decodeText(data);
    } catch {
      return fail("Use UTF-8 text, or UTF-16 text with a byte-order mark.");
    }
    if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text))
      fail("This file contains binary data.");
    // Keep large text files editable without truncating them or exceeding the
    // existing per-block limit. Do not split a Unicode surrogate pair.
    const nodes: DocNode[] = [];
    do {
      let end = Math.min(40_000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      nodes.push({
        id: randomUUID(),
        type: "text",
        text: text.slice(0, end),
        bold: false,
        italic: false,
        color: "default",
      });
      text = text.slice(end);
    } while (text.length);
    return { name: file.name, nodes, asset: undefined };
  });
}
