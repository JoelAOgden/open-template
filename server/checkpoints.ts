import { z } from "zod";
import type { CheckpointInfo } from "../shared/model.js";
import type { Store } from "./store.js";
import {
  AppError, allowedEntry, changes, manifestHash, relativeParts,
  type Manifest,
} from "./files.js";

const InfoSchema = z.object({
  file: z.string().regex(/^[a-f0-9]{64}\.json$/).optional(),
  runId: z.string().uuid(),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileCount: z.number().int().nonnegative(),
}).strict();
const RecordSchema = z.object({
  info: InfoSchema,
  base: z.record(z.string()),
  result: z.record(z.string()),
}).strict();

// Check saved bytes with the same path/size boundaries as live project files.
// Saved artifacts are data, never trusted filesystem paths or runnable code.
function validate(files: Manifest) {
  let size = 0;
  for (const [file, bytes] of Object.entries(files)) {
    const parts = relativeParts(file);
    if (parts.length > 21 || parts.some((part) => !allowedEntry(part)))
      throw new AppError("Unsafe checkpoint file path.");
    if (bytes.length > 1024 * 1024)
      throw new AppError("Checkpoint file exceeds the project size limit.");
    for (let i = 1; i < parts.length; i++)
      if (Object.hasOwn(files, parts.slice(0, i).join("/")))
        throw new AppError("Checkpoint contains conflicting file paths.");
    size += bytes.length;
  }
  if (size > 20 * 1024 * 1024 || Object.keys(files).length > 1500)
    throw new AppError("Checkpoint exceeds the project size limit.");
}
function decode(files: Record<string, string>): Manifest {
  const result: Manifest = Object.create(null);
  for (const [file, text] of Object.entries(files)) {
    const bytes = Buffer.from(text, "base64");
    if (bytes.toString("base64") !== text)
      throw new AppError("Invalid checkpoint file encoding.");
    result[file] = bytes;
  }
  validate(result);
  return result;
}
export async function readCheckpoint(store: Store, expected: CheckpointInfo) {
  InfoSchema.parse(expected);
  const saved = RecordSchema.parse(await store.load<unknown>(`runs/${expected.runId}/${expected.file ?? "checkpoint.json"}`));
  const base = decode(saved.base), result = decode(saved.result);
  if (
    saved.info.runId !== expected.runId ||
    saved.info.file !== expected.file ||
    saved.info.baseHash !== expected.baseHash ||
    saved.info.resultHash !== expected.resultHash ||
    saved.info.fileCount !== expected.fileCount ||
    manifestHash(base) !== expected.baseHash ||
    manifestHash(result) !== expected.resultHash ||
    changes(base, result).length !== expected.fileCount
  ) throw new AppError("Saved work failed its integrity check. Nothing was imported.", 409);
  return { info: saved.info, base, result };
}

