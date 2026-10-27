import fs from "node:fs/promises";
import type {
  DebugFile,
  DebugFileIndex,
  PlanSession,
  DraftConversation,
} from "../shared/model.js";
import { referenceFiles } from "./reference-files.js";
import {
  AppError,
  checkedPath,
  isBinary,
  readSafe,
} from "./files.js";
import { definitionDiff, planningContext } from "./definition-context.js";
import type { Store } from "./store.js";
import { readCheckpoint } from "./checkpoints.js";

const priority = (file: string) =>
  file === "AGENTS.md"
    ? 0
    : file.startsWith("skills/")
      ? 1
      : file.startsWith("generated/")
        ? 2
        : file.startsWith("documents/")
          ? 3
          : file.startsWith("assets/")
            ? 4
            : file.startsWith("project_src/")
              ? 6
              : 5;

export async function debugFiles(
  store: Store,
  session: PlanSession | null,
  scope: "current" | "plan",
  selected?: string,
): Promise<DebugFileIndex | DebugFile> {
  if (scope === "plan" && !session)
    throw new AppError("No plan snapshot available.", 404);
  const frozen = scope === "plan" ? session : null;
  const snapshot = frozen?.snapshot ?? (await store.snapshot());
  const project = await store.projectManifest();
  const context =
    frozen?.planningContext ??
    planningContext(
      definitionDiff(
        await store.appliedSnapshot(
          frozen ? frozen.baseSnapshotHash : store.state.appliedSnapshotHash,
        ),
        snapshot,
      ),
      snapshot,
      project,
    );
  const activeRun = !frozen && store.state.runId ? await store.run(store.state.runId) : undefined;
  const texts = await referenceFiles({
    snapshot,
    planningContext: context,
    instructions: frozen?.instructions,
    refinement: frozen?.refinement ?? (!frozen ? activeRun?.refinement : undefined),
    startup: activeRun?.startup,
    executionFailure: frozen?.executionFailure,
    checkpoint: frozen?.checkpoint,
    draft: frozen?.draft ?? (!frozen && store.state.draftRunId
      ? (await store.load<{ draft?: DraftConversation }>(`runs/${store.state.draftRunId}/context.json`).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return { draft: undefined };
          throw error;
        })).draft : undefined),
    previous: frozen?.recovery ?? frozen?.revisions.find(
      (revision) => revision.id === frozen.currentRevision,
    ),
    message: frozen?.messages.at(-1)?.text,
  });
  const entries = new Map<string, DebugFile>();
  for (const [file, text] of texts)
    entries.set(file, {
      path: file,
      kind: "text",
      size: Buffer.byteLength(text),
      text,
    });
  for (const [file, content] of Object.entries(project))
    entries.set(`project_src/${file}`, {
      path: `project_src/${file}`,
      kind: isBinary(content) ? "binary" : "text",
      size: content.length,
      text: isBinary(content) ? null : content.toString(),
    });
  const checkpoint = frozen?.checkpoint ?? (!frozen ? store.state.checkpoint : undefined);
  if (checkpoint) {
    const saved = await readCheckpoint(store, checkpoint);
    for (const [file, content] of Object.entries(saved.result))
      entries.set(`saved-work/${file}`, {
        path: `saved-work/${file}`,
        kind: isBinary(content) ? "binary" : "text",
        size: content.length,
        text: isBinary(content) ? null : content.toString(),
      });
  }
  for (const assetId of new Set(
    snapshot.project.documents.flatMap((doc) => doc.assetRefs),
  )) {
    const file = `assets/${assetId}`;
    const info = await fs.stat(await checkedPath(store.dataDir, file));
    if (!info.isFile()) throw new AppError("Invalid reference asset.");
    entries.set(file, {
      path: file,
      kind: "image",
      size: info.size,
      text: null,
      assetId,
    });
  }
  if (selected !== undefined) {
    // Membership in the generated inventory is the entire read allowlist.
    const file = entries.get(selected);
    if (!file) throw new AppError("Reference file not found.", 404);
    if (file.assetId?.endsWith(".svg"))
      file.text = (
        await readSafe(store.dataDir, file.path, false, Infinity)
      ).toString();
    return file;
  }
  return {
    snapshotHash: snapshot.hash,
    files: [...entries.values()]
      .map(({ path, kind, size }) => ({ path, kind, size }))
      .sort(
        (a, b) =>
          priority(a.path) - priority(b.path) || a.path.localeCompare(b.path),
      ),
  };
}
