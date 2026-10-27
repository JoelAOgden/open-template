import type { Snapshot, PlanningContext, Plan, ExecutionFailure, CheckpointInfo, DraftConversation, StartCheck, Refinement } from "../shared/model.js";
type ReferenceInput = {
 snapshot: Snapshot; planningContext: PlanningContext; previous?: Plan; message?: string; instructions?: string;
 executionFailure?: ExecutionFailure; checkpoint?: CheckpointInfo; draft?: DraftConversation; startup?: StartCheck; refinement?: Refinement;
};
export function changeReferences(
  r: Pick<ReferenceInput, "snapshot" | "planningContext">,
) {
  const documents = new Map(
    r.snapshot.project.documents.map((doc) => [doc.id, doc]),
  );
  const sections = new Map(
    r.snapshot.project.sections.map((section) => [section.id, section]),
  );
  return r.planningContext.definitionDiff.changes.map((change, index) => {
    const doc = documents.get(change.documentId ?? "");
    const section = sections.get(doc?.sectionId ?? change.sectionId ?? "");
    return {
      path: change.path,
      kind: change.kind,
      documentId: change.documentId,
      sectionId: change.sectionId,
      summary:
        change.summary ??
        `${{ added: "Added", modified: "Updated", deleted: "Removed" }[change.kind]} ${doc ? `document ${JSON.stringify(doc.title)} in ${JSON.stringify(section?.displayName ?? "section")}` : section ? `section ${JSON.stringify(section.displayName)}` : JSON.stringify(change.path)}.`,
      description:
        change.description ??
        `${{ added: "Added", modified: "Updated", deleted: "Removed" }[change.kind]} ${doc ? `document ${JSON.stringify(doc.title)}` : section ? `definition in ${JSON.stringify(section.displayName)}` : `definition ${JSON.stringify(change.path)}`}. Read the referenced patch for the exact update.`,
      patch: `diffs/${String(index + 1).padStart(5, "0")}.patch`,
      document: doc ? `documents/${doc.id}.json` : null,
      markdown:
        doc && section ? `generated/${section.slug}/${doc.id}.md` : null,
      skill: section ? `skills/${section.slug}/SKILL.md` : null,
    };
  });
}

// Render historical and current definition references for the read-only Debug browser.
export async function referenceFiles(r: ReferenceInput) {
  const files = new Map<string, string>();
  const write = (file: string, value: unknown) =>
    files.set(file, JSON.stringify(value, null, 2));
  files.set("AGENTS.md", r.instructions ?? "# open-template\n\nThe previous pipeline has been removed. No agent workflow is installed.\n");
  const entries = changeReferences(r);
  await write("changes.json", {
    baseSnapshotHash: r.planningContext.definitionDiff.baseSnapshotHash,
    candidateSnapshotHash: r.snapshot.hash,
    changes: entries,
  });
  for (const [index, entry] of entries.entries())
    files.set(
      entry.patch,
      r.planningContext.definitionDiff.changes[index].diff,
    );
  const sections = r.snapshot.project.sections.map((section) => ({
    ...section,
    skill: `skills/${section.slug}/SKILL.md`,
    suggested: r.planningContext.sectionIds.includes(section.id),
  }));
  const documents = r.snapshot.project.documents.map((doc) => {
    const section = sections.find((section) => section.id === doc.sectionId)!;
    return {
      id: doc.id,
      title: doc.title,
      sectionId: doc.sectionId,
      document: `documents/${doc.id}.json`,
      markdown: `generated/${section.slug}/${doc.id}.md`,
      suggested: r.planningContext.documentIds.includes(doc.id),
    };
  });
  await write("index.json", {
    name: r.snapshot.project.name,
    snapshotHash: r.snapshot.hash,
    sections,
    documents,
  });
  for (const [index, doc] of r.snapshot.project.documents.entries())
    await write(documents[index].document, doc);
  for (const [file, text] of Object.entries(r.snapshot.markdown))
    files.set(`generated/${file}`, text);
  for (const section of sections)
    files.set(section.skill, r.snapshot.skills[section.slug] ?? "");
  await write("project-files.json", {
    files: r.planningContext.projectFiles,
    suggestions: r.planningContext.files.map(({ path, reason }) => ({
      path,
      reason,
    })),
  });
  if (r.previous) await write("plan.json", r.previous);
  if (r.refinement) await write("refinement.json", r.refinement);
  if (r.executionFailure) await write("execution-result.json", r.executionFailure);
  if (r.checkpoint) await write("checkpoint.json", r.checkpoint);
  if (r.draft) await write("draft.json", r.draft);
  if (r.startup ?? r.executionFailure?.startup)
    await write("startup-check.json", r.startup ?? r.executionFailure?.startup);
  if (r.message) files.set("discussion.txt", r.message);
  files.set(
    "README.md",
    "# Project reference\n\nRead AGENTS.md first. The frozen specification is the source of truth. Start with index.json for documents and skills, and changes.json for exact change references. Project source is available separately in the working directory.\n",
  );
  return files;
}
