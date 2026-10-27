import type { Document, Snapshot } from "../shared/model.js";

export function excerpt(value: string, length = 180) {
  const plain = value.replace(/\s+/g, " ").trim();
  return plain.length <= length ? plain : `${plain.slice(0, length)}…`;
}

function writing(doc: Document | undefined) {
  return (doc?.nodes ?? [])
    .flatMap((node) => {
      const content = (() => {
      switch (node.type) {
        case "text":
        case "heading":
          return [node.text];
        case "list":
          return node.items;
        case "table":
          return node.rows.map((row) => row.join(" | "));
        default:
          return [];
      }
      })();
      return node.title ? [node.title, ...content] : content;
    })
    .join("\n");
}

function textUpdate(before: string, after: string) {
  let start = 0,
    end = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  // Include a little surrounding context so a one-word edit remains intelligible.
  const from = Math.max(0, start - 45);
  const oldText = excerpt(
    before.slice(from, Math.min(before.length, before.length - end + 45)),
  );
  const newText = excerpt(
    after.slice(from, Math.min(after.length, after.length - end + 45)),
  );
  if (!before.trim()) return `Added text: ${JSON.stringify(newText)}.`;
  if (!after.trim()) return `Removed text: ${JSON.stringify(oldText)}.`;
  return `Changed text from ${JSON.stringify(oldText)} to ${JSON.stringify(newText)}.`;
}

export function describeChange(
  file: string,
  kind: "added" | "modified" | "deleted",
  before: Snapshot | null,
  after: Snapshot,
  sectionId?: string,
  documentId?: string,
  brief = false,
) {
  const verb = { added: "Added", modified: "Updated", deleted: "Removed" }[
    kind
  ];
  const oldSection = before?.project.sections.find((s) => s.id === sectionId);
  const section =
    after.project.sections.find((s) => s.id === sectionId) ?? oldSection;
  if (documentId) {
    const oldDoc = before?.project.documents.find((d) => d.id === documentId);
    const doc = after.project.documents.find((d) => d.id === documentId);
    const label = JSON.stringify((doc ?? oldDoc)!.title);
    const place = JSON.stringify(section?.displayName ?? "section");
    if (brief)
      return `${verb} document ${label} ${doc ? "in" : "from"} ${place}.`;
    if (!doc)
      return `Removed document ${label} from ${place}. Its former requirements are available in the patch.`;
    const details: string[] = [];
    if (oldDoc && oldDoc.title !== doc.title)
      details.push(`Renamed from ${JSON.stringify(oldDoc.title)}.`);
    if (oldDoc && oldDoc.sectionId !== doc.sectionId)
      details.push(
        `Moved from ${JSON.stringify(before?.project.sections.find((s) => s.id === oldDoc.sectionId)?.displayName ?? oldDoc.sectionId)}.`,
      );
    const oldText = writing(oldDoc),
      newText = writing(doc);
    if (oldText !== newText) details.push(textUpdate(oldText, newText));
    const oldImages = (oldDoc?.nodes ?? []).filter(
      (node) => node.type === "image",
    );
    const images = doc.nodes.filter((node) => node.type === "image");
    const added = images.filter(
      (image) => !oldImages.some((old) => old.assetId === image.assetId),
    );
    const removed = oldImages.filter(
      (image) => !images.some((current) => current.assetId === image.assetId),
    );
    if (added.length)
      details.push(
        `Added ${added.length} image(s): ${added
          .slice(0, 3)
          .map((image) => JSON.stringify(excerpt(image.alt, 60)))
          .join(", ")}${added.length > 3 ? ", …" : ""}.`,
      );
    if (removed.length) details.push(`Removed ${removed.length} image(s).`);
    if (!details.length)
      details.push(
        kind === "added"
          ? "Empty document."
          : "Updated formatting, image captions or block structure.",
      );
    return `${verb} document ${label} in ${place}. ${details.join(" ")}`;
  }
  if (file.startsWith("skills/"))
    return `${verb} the ${JSON.stringify(section?.displayName ?? sectionId)} section skill.${brief ? "" : " Read its instructions before planning changes in that section."}`;
  if (section) {
    if (oldSection && oldSection.displayName !== section.displayName)
      return `Renamed section ${JSON.stringify(oldSection.displayName)} to ${JSON.stringify(section.displayName)}.`;
    return `${verb} section ${JSON.stringify(section.displayName)}.`;
  }
  return before
    ? `Renamed project from ${JSON.stringify(before.project.name)} to ${JSON.stringify(after.project.name)}.`
    : `Created project ${JSON.stringify(after.project.name)}.`;
}
