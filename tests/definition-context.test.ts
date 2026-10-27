import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, paragraph } from "../server/store.js";
import { Studio } from "../server/studio.js";
import {
  definitionDiff,
  definitionPatch,
  planningContext,
} from "../server/definition-context.js";
import { atomicWrite, manifest } from "../server/files.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-workspace-"));
  const store = new Store(root), studio = new Studio(store);
  await studio.init();
  t.after(async () => { await studio.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, studio };
}
async function writeText(store: Store, index: number, text: string) {
  const doc = store.project.documents[index];
  return store.saveDocument(doc.id, { ...doc, nodes: [paragraph(text)] });
}

test("definition diff tracks semantic additions, edits, removals, formatting and skills without save metadata", async (t) => {
  const { store } = await fixture(t);
  await writeText(store, 0, "Keep the menu blue.");
  const before = await store.snapshot();
  const initial = definitionDiff(null, before);
  assert.ok(initial.changes.every((change) => change.kind === "added"));
  assert.equal(initial.baseSnapshotHash, null);
  const after = structuredClone(before);
  after.project.documents[0].version += 5;
  after.project.documents[0].nodes[0].id = "new-node-id";
  assert.deepEqual(definitionDiff(before, after).changes, []);
  const node = after.project.documents[0].nodes[0];
  assert.equal(node.type, "text");
  if (node.type !== "text") throw new Error("Expected text");
  node.text = "Keep the menu green.";
  node.color = "green";
  let delta = definitionDiff(before, after);
  assert.equal(delta.changes.length, 1);
  assert.equal(delta.changes[0].documentId, before.project.documents[0].id);
  assert.match(delta.changes[0].diff, /-\s+"text": "Keep the menu blue\."/);
  assert.match(delta.changes[0].diff, /\+\s+"text": "Keep the menu green\."/);
  assert.match(delta.changes[0].diff, /\+\s+"color": "green"/);
  assert.doesNotMatch(delta.changes[0].diff, /version|new-node-id/);
  assert.match(
    delta.changes[0].description!,
    /Changed text from "Keep the menu blue\." to "Keep the menu green\."/,
  );
  after.skills.design += "\nRespect contrast.\n";
  after.project.documents.splice(1, 1);
  after.project.documents.push({
    ...after.project.documents[0],
    id: "new-document",
    title: "New requirements",
  });
  delta = definitionDiff(before, after);
  assert.ok(
    delta.changes.some(
      (change) =>
        change.path === "skills/design/SKILL.md" && change.kind === "modified",
    ),
  );
  assert.ok(
    delta.changes.some(
      (change) =>
        change.documentId === before.project.documents[1].id &&
        change.kind === "deleted",
    ),
  );
  assert.ok(
    delta.changes.some(
      (change) =>
        change.documentId === "new-document" && change.kind === "added",
    ),
  );
});

test("definition patches reconstruct changes including separate hunks and large rewrites", () => {
  // Read standard unified hunks independently to verify positions and contents.
  const apply = (source: string[], patch: string) => {
    const result: string[] = [];
    let cursor = 0;
    for (const line of patch.split("\n").slice(2)) {
      const hunk = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);
      if (hunk) {
        const start = Number(hunk[1]) - (Number(hunk[2]) ? 1 : 0);
        result.push(...source.slice(cursor, start));
        cursor = start;
      } else if (line.startsWith("+")) result.push(line.slice(1));
      else {
        assert.equal(source[cursor++], line.slice(1));
        if (line.startsWith(" ")) result.push(line.slice(1));
      }
    }
    result.push(...source.slice(cursor));
    return result;
  };
  const original = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const revised = [...original];
  revised[4] = "changed";
  revised.splice(31, 2, "new", "extra", "tail");
  const cases: [string[], string[]][] = [
    [[], ["added"]],
    [["removed"], []],
    [original, revised],
    [
      ["repeat", "repeat", "tail"],
      ["repeat", "new", "repeat", "tail"],
    ],
    [
      Array.from({ length: 1100 }, (_, i) => `old ${i}`),
      Array.from({ length: 1100 }, (_, i) => `new ${i}`),
    ],
  ];
  for (const [before, after] of cases) {
    const patch = definitionPatch(
      "requirements.json",
      before.length ? before.join("\n") + "\n" : null,
      after.length ? after.join("\n") + "\n" : null,
    );
    assert.deepEqual(apply(before, patch), after);
  }
  const patch = definitionPatch(
    "requirements.json",
    original.join("\n"),
    revised.join("\n"),
  );
  assert.equal(patch.match(/^@@ /gm)?.length, 2);
  assert.ok(!patch.includes("line 15"));
});

test("planning selects relevant definitions, skills, code and imports while keeping source excerpts bounded", async (t) => {
  const { store } = await fixture(t);
  await writeText(store, 0, "Keep invoices private.");
  await writeText(store, 1, "Use blue navigation.");
  await writeText(store, 2, "Use the existing component structure.");
  await writeText(store, 3, "Test keyboard navigation.");
  const baseline = await store.snapshot();
  await writeText(
    store,
    1,
    "Change src/navigation.tsx to use green navigation.",
  );
  const snapshot = await store.snapshot();
  await atomicWrite(store.codeDir, "package.json", '{"name":"example"}', true);
  await atomicWrite(
    store.codeDir,
    "src/navigation.tsx",
    'import { palette } from "./palette.js";\nexport const navigation = palette;\n' +
      "// navigation\n".repeat(1000),
    true,
  );
  await atomicWrite(
    store.codeDir,
    "src/palette.ts",
    'export const palette = "blue";\n',
    true,
  );
  await atomicWrite(
    store.codeDir,
    "src/invoices.ts",
    'export const invoice = "unrelated";\n',
    true,
  );
  await fs.writeFile(path.join(store.codeDir, ".env"), "PRIVATE_SECRET");
  const context = planningContext(
    definitionDiff(baseline, snapshot),
    snapshot,
    await manifest(store.codeDir),
  );
  assert.ok(!context.documentIds.includes(snapshot.project.documents[0].id));
  assert.ok(context.documentIds.includes(snapshot.project.documents[1].id));
  assert.ok(context.documentIds.includes(snapshot.project.documents[2].id));
  assert.ok(context.documentIds.includes(snapshot.project.documents[3].id));
  assert.ok(
    context.files.some(
      (file) => file.path === "src/navigation.tsx" && file.truncated,
    ),
  );
  assert.ok(context.files.some((file) => file.path === "src/palette.ts"));
  assert.ok(context.files.some((file) => file.path === "package.json"));
  assert.ok(!context.files.some((file) => file.path === "src/invoices.ts"));
  assert.ok(context.files.every((file) => (file.content?.length ?? 0) <= 8000));
  assert.ok(
    context.files.reduce((sum, file) => sum + (file.content?.length ?? 0), 0) <=
      48000,
  );
});
