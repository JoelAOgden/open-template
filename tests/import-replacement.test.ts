import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, paragraph } from "../server/store.js";
import { readSafe } from "../server/files.js";
import { definitionDiff } from "../server/definition-context.js";
import type { Document } from "../shared/model.js";

const file = (name: string, content: string) => ({
  name, base64: Buffer.from(content).toString("base64"),
});
const replace = (doc: Document, content: string) => ({
  ...file(doc.title, content),
  resolution: { action: "replace", documentId: doc.id, version: doc.version },
});
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-replace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new Store(root);
  await store.init();
  return { store, target: { kind: "section", id: store.project.sections[0].id } };
}

test("replacement retains document identity and produces only a content update, with no diff for identical content", async (t) => {
  const { store, target } = await fixture(t);
  const { documents: [original] } = await store.importFiles({ target, files: [file("Catalogue.json", '{"hull":100}')] });
  const before = await store.snapshot();
  await store.saveAppliedSnapshot(before);
  store.state.appliedSnapshotHash = before.hash;
  await store.saveState();
  const { documents: [updated] } = await store.importFiles({ target, files: [replace(original, '{"hull":150}')] });
  assert.equal(updated.id, original.id);
  assert.equal(updated.title, original.title);
  assert.equal(updated.version, original.version + 1);
  assert.deepEqual(store.project.sections, before.project.sections);
  assert.equal(store.project.documents.length, before.project.documents.length);
  assert.equal(store.state.appliedSnapshotHash, before.hash);
  assert.deepEqual(await store.appliedSnapshot(), before);
  const after = await store.snapshot();
  const changes = definitionDiff(before, after).changes;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "modified");
  assert.equal(changes[0].documentId, original.id);
  assert.equal(changes[0].summary, 'Updated document "Catalogue.json" in "Features".');
  assert.match(changes[0].diff, /100/);
  assert.match(changes[0].diff, /150/);
  await store.importFiles({ target, files: [replace(updated, '{"hull":150}')] });
  assert.deepEqual(definitionDiff(after, await store.snapshot()).changes, []);
  const reopened = new Store(store.root);
  await reopened.init();
  assert.deepEqual(reopened.project, store.project);
  assert.equal(reopened.state.appliedSnapshotHash, before.hash);
});

test("mixed imports update existing text and images in place while adding new documents", async (t) => {
  const { store, target } = await fixture(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
  const { documents: [text, image] } = await store.importFiles({
    target, files: [file("Notes.md", "Old notes"), file("Hull.svg", svg)],
  });
  const before = await store.snapshot();
  const { documents } = await store.importFiles({ target, files: [
    replace(text, "Updated notes"), file("New.json", "[1,2,3]"),
    replace(image, svg.replace('width="10"', 'width="20"')),
  ] });
  assert.deepEqual(documents.map((doc) => doc.id), [text.id, documents[1].id, image.id]);
  assert.notEqual(documents[2].assetRefs[0], image.assetRefs[0]);
  assert.equal((await readSafe(store.dataDir, `assets/${image.assetRefs[0]}`)).toString(), svg);
  assert.deepEqual(definitionDiff(before, await store.snapshot()).changes.map((change) => change.kind).sort(), ["added", "modified", "modified"]);
  assert.deepEqual(store.project.sections[0].documentIds, [...before.project.sections[0].documentIds, documents[1].id]);
  assert.match((await readSafe(store.dataDir, `generated/features/${text.id}.md`)).toString(), /Updated notes/);
  const reopened = new Store(store.root);
  await reopened.init();
  assert.deepEqual(reopened.project, store.project);
});

test("filename conflicts require a choice; keep both creates unique names within the target section", async (t) => {
  const { store, target } = await fixture(t);
  const { documents: [original] } = await store.importFiles({ target, files: [file("Catalogue.json", "Original")] });
  const before = structuredClone(store.project);
  await assert.rejects(store.importFiles({ target, files: [file("Other.txt", "New"), file("catalogue.JSON", "Duplicate")] }), /already exists/);
  assert.deepEqual(store.project, before);
  const { documents: copies } = await store.importFiles({ target, files: [
    { ...file("Catalogue.json", "Copy 1"), resolution: { action: "keep_both" } },
    { ...file("Catalogue.json", "Copy 2"), resolution: { action: "keep_both" } },
  ] });
  assert.deepEqual(copies.map((doc) => doc.title), ["Catalogue (2).json", "Catalogue (3).json"]);
  assert.deepEqual(store.project.documents.find((doc) => doc.id === original.id), original);
  const other = await store.importFiles({ target: { kind: "section", id: store.project.sections[1].id }, files: [file("Catalogue.json", "Another section")] });
  assert.equal(other.documents[0].title, "Catalogue.json");
  const { documents: batch } = await store.importFiles({ target, files: [file("Fresh.md", "First"), file("Fresh.md", "Second")] });
  assert.deepEqual(batch.map((doc) => doc.title), ["Fresh.md", "Fresh (2).md"]);
  // Older workspaces may already contain duplicate titles: an explicit ID chooses the replacement.
  const duplicate = await store.addDocument(target.id, original.title, [paragraph("Legacy duplicate")]);
  const { documents: [updated] } = await store.importFiles({ target, files: [replace(duplicate, "Chosen duplicate")] });
  assert.equal(updated.id, duplicate.id);
  assert.deepEqual(store.project.documents.find((doc) => doc.id === original.id), original);
});

test("stale, renamed, cross-section and duplicate replacement choices cannot overwrite documents", async (t) => {
  const { store, target } = await fixture(t);
  const { documents: [original] } = await store.importFiles({ target, files: [file("Notes.md", "Original")] });
  const edited = await store.saveDocument(original.id, { ...original, nodes: [paragraph("Unsaved at prompt time")] });
  const other = await store.addDocument(store.project.sections[1].id, original.title);
  const before = structuredClone(store.project);
  for (const files of [
    [file("Other.txt", "New"), replace(original, "Stale")],
    [replace(other, "Wrong section")],
    [{ ...replace(edited, "Wrong name"), name: "Other.md" }],
    [replace(edited, "First"), replace(edited, "Second")],
    [replace(edited, "Valid"), file("Broken.png", "Not an image")],
  ]) {
    await assert.rejects(store.importFiles({ target, files }));
    assert.deepEqual(store.project, before);
  }
  await assert.rejects(store.importFiles({ target: { kind: "document", id: edited.id, version: edited.version }, files: [replace(edited, "Must not append a replacement")] }), /section imports only/);
  await store.saveDocument(edited.id, { ...edited, title: "Renamed.md" });
  await assert.rejects(store.importFiles({ target, files: [replace(edited, "Old name")] }), /document changed/);
});

test("failed mixed replacement imports roll back existing mirrors and remove new documents", async (t) => {
  const { store, target } = await fixture(t);
  const { documents: [doc] } = await store.importFiles({ target, files: [file("Notes.md", "Original")] });
  const before = structuredClone(store.project);
  const paths = ["project.json", `documents/${doc.id}.json`, `generated/features/${doc.id}.md`];
  const contents = await Promise.all(paths.map((file) => readSafe(store.dataDir, file)));
  const documents = await fs.readdir(path.join(store.dataDir, "documents"));
  const generated = await fs.readdir(path.join(store.dataDir, "generated/features"));
  t.mock.method(store, "saveProject", async () => {
    await store.exportDefinitions();
    throw new Error("Disk failure");
  });
  await assert.rejects(store.importFiles({ target, files: [replace(doc, "Changed"), file("New.md", "New")] }), /Disk failure/);
  assert.deepEqual(store.project, before);
  assert.deepEqual(await Promise.all(paths.map((file) => readSafe(store.dataDir, file))), contents);
  assert.deepEqual(await fs.readdir(path.join(store.dataDir, "documents")), documents);
  assert.deepEqual(await fs.readdir(path.join(store.dataDir, "generated/features")), generated);
});
