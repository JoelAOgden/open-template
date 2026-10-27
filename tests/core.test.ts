import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, markdown } from "../server/store.js";
import { Studio } from "../server/studio.js";
import {
  atomicWrite,
  checkedPath,
  changes,
  manifest,
  readSafe,
} from "../server/files.js";
import { PlanSchema } from "../shared/model.js";
import { appendLog } from "../server/processes.js";
import { localUrl, Runner } from "../server/runner.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-workspace-"));
  const store = new Store(root), studio = new Studio(store);
  await studio.init();
  t.after(async () => { await studio.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, studio };
}
test("new install has four unique sections with starter templates, discoverable skills, and deterministic exports", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(
    store.project.sections.map((s) => s.displayName),
    ["Features", "Design", "Architecture", "Testing"],
  );
  assert.ok(store.project.documents.every((d) => d.nodes.length === 2 && JSON.stringify(d.nodes).includes("{replace me}")));
  for (const s of store.project.sections)
    assert.match(
      (await readSafe(store.skillDir, `skills/${s.slug}/SKILL.md`)).toString(),
      /never edit authoritative definitions/,
    );
  await assert.rejects(store.addSection("FEATURES"), /already exists/);
  await store.addSection("User Research");
  await assert.rejects(store.addSection("user-research"), /already exists/);
  await assert.rejects(store.addSection("!!!"), /letters or numbers/);
  assert.deepEqual(
    markdown(store.project),
    markdown(structuredClone(store.project)),
  );
  const again = new Store(store.root);
  await again.init();
  assert.deepEqual(again.project, store.project);
});
test("definition deletion rejects stale versions and unsafe paths and rolls back save failures", async (t) => {
  const { store } = await fixture(t);
  const section = await store.addSection("Research");
  const original = store.project.documents.find(d => d.sectionId === section.id)!;
  const updated = await store.saveDocument(original.id, {
    ...original,
    title: "Updated",
  });
  await assert.rejects(
    store.deleteDocument(original.id, original.version),
    /changed elsewhere/,
  );
  await assert.rejects(
    store.deleteSection(section.id, [original]),
    /changed elsewhere/,
  );
  const stale = store.project.documents.filter(
    (d) => d.sectionId === section.id,
  );
  await store.addDocument(section.id, "Additional");
  await assert.rejects(
    store.deleteSection(section.id, stale),
    /changed elsewhere/,
  );
  const before = structuredClone(store.project);
  const metadata = await readSafe(store.dataDir, "project.json");
  const save = store.saveProject.bind(store);
  store.saveProject = async () => {
    throw new Error("Simulated save failure");
  };
  await assert.rejects(
    store.deleteSection(
      section.id,
      before.documents.filter((d) => d.sectionId === section.id),
    ),
    /save failure/,
  );
  store.saveProject = save;
  assert.deepEqual(store.project, before);
  assert.deepEqual(await readSafe(store.dataDir, "project.json"), metadata);
  assert.ok(await readSafe(store.skillDir, "skills/research/SKILL.md"));
  for (const doc of before.documents.filter(
    (d) => d.sectionId === section.id,
  )) {
    assert.ok(await readSafe(store.dataDir, `documents/${doc.id}.json`));
    assert.ok(await readSafe(store.dataDir, `generated/research/${doc.id}.md`));
  }
  const skill = path.join(store.skillDir, "skills/research/SKILL.md");
  await fs.unlink(skill);
  await fs.symlink(path.join(store.dataDir, "project.json"), skill);
  await assert.rejects(
    store.deleteSection(
      section.id,
      before.documents.filter((d) => d.sectionId === section.id),
    ),
    /Links/,
  );
  assert.deepEqual(store.project, before);
  const mirror = path.join(store.dataDir, `documents/${updated.id}.json`);
  await fs.unlink(mirror);
  await fs.symlink(path.join(store.dataDir, "project.json"), mirror);
  await assert.rejects(
    store.deleteDocument(updated.id, updated.version),
    /Links/,
  );
  assert.deepEqual(await readSafe(store.dataDir, "project.json"), metadata);
});
test("definitions support all node types, image validation, persistence and optimistic concurrency", async (t) => {
  const { store } = await fixture(t);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=";
  const assetId = await store.saveImage(png);
  assert.equal(await store.saveImage(png), assetId);
  await assert.rejects(
    store.saveImage(
      Buffer.from("<html>not an image</html>").toString("base64"),
    ),
    /PNG/,
  );
  const doc = store.project.documents[0];
  const saved = await store.saveDocument(doc.id, {
    ...doc,
    nodes: [
      {
        id: "t",
        type: "text",
        text: "Build a small app",
        bold: true,
        italic: false,
        color: "blue",
      },
      { id: "h", type: "heading", text: "Details", level: "2" },
      { id: "l", type: "list", items: ["First", "Second"], ordered: true },
      {
        id: "tb",
        type: "table",
        rows: [
          ["A", "B"],
          ["x|y", "z"],
        ],
      },
      { id: "i", type: "image", assetId, alt: "Reference" },
    ],
  });
  assert.deepEqual(saved.assetRefs, [assetId]);
  const md = Object.values(markdown(store.project))[0];
  assert.match(md, /\*\*Build a small app\*\*/);
  assert.match(md, /1\. First/);
  assert.match(md, /x\\\|y/);
  assert.match(md, /\.\.\/\.\.\/assets\//);
  await assert.rejects(store.saveDocument(doc.id, doc), /changed elsewhere/);
  const again = new Store(store.root);
  await again.init();
  assert.deepEqual(again.project.documents[0], saved);
});
test("project file boundaries reject traversal, links, hard links and secret entries", async (t) => {
  const { store, root } = await fixture(t);
  for (const p of [
    "../project.json",
    "/etc/passwd",
    "a/../../file",
    "a\\b",
    "file\0",
    "a//b",
    "a:drive",
    ".env",
    ".env.local",
    ".npmrc",
    "private.key",
    ".agents/skills/a",
    "credentials.json",
    "__proto__",
    "constructor",
  ])
    await assert.rejects(checkedPath(store.codeDir, p, true));
  await fs.writeFile(path.join(root, "outside.txt"), "PRIVATE");
  await fs.symlink(
    path.join(root, "outside.txt"),
    path.join(store.codeDir, "escape.txt"),
  );
  await assert.rejects(readSafe(store.codeDir, "escape.txt", true), /Links/);
  await assert.rejects(manifest(store.codeDir), /Links/);
  await fs.unlink(path.join(store.codeDir, "escape.txt"));
  await fs.symlink(root, path.join(store.codeDir, "linked"));
  await assert.rejects(
    atomicWrite(store.codeDir, "linked/new.txt", "no", true),
    /Links/,
  );
  await fs.unlink(path.join(store.codeDir, "linked"));
  await fs.link(
    path.join(root, "outside.txt"),
    path.join(store.codeDir, "hard.txt"),
  );
  await assert.rejects(readSafe(store.codeDir, "hard.txt", true), /Links/);
  await fs.unlink(path.join(store.codeDir, "hard.txt"));
  await fs.writeFile(path.join(store.codeDir, ".env"), "SECRET");
  await fs.mkdir(path.join(store.codeDir, "node_modules"));
  await fs.symlink(root, path.join(store.codeDir, "node_modules", "linked"));
  await fs.writeFile(path.join(store.codeDir, "safe.txt"), "OK");
  assert.deepEqual(Object.keys(await manifest(store.codeDir)), ["safe.txt"]);
});
test("root symlinks and oversized files are rejected", async (t) => {
  const { root, store } = await fixture(t);
  await fs.symlink(store.codeDir, path.join(root, "linked-root"));
  await assert.rejects(
    manifest(path.join(root, "linked-root")),
    /Root directories/,
  );
  await fs.writeFile(
    path.join(store.codeDir, "large.txt"),
    Buffer.alloc(1024 * 1024 + 1),
  );
  await assert.rejects(manifest(store.codeDir), /under 1024 KB/);
});
test("plan schema rejects executable UI and malformed diagram/table components", () => {
  assert.equal(
    PlanSchema.safeParse({
      summary: "Unsafe",
      components: [{ type: "html", html: "<script />" }],
      proposals: [],
    }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      summary: "Bad diagram",
      components: [
        {
          type: "diagram",
          title: "A",
          nodes: [{ id: "a", label: "A" }],
          edges: [{ from: "a", to: "missing" }],
        },
      ],
      proposals: [],
    }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      summary: "Bad table",
      components: [
        { type: "table", title: "A", columns: ["A"], rows: [["a", "b"]] },
      ],
      proposals: [],
    }).success,
    false,
  );
});

test("file diffs include additions, deletions, changes and binary status", () => {
  const result = changes(
    {
      "old.txt": Buffer.from("old"),
      "same.txt": Buffer.from("same"),
      "update.txt": Buffer.from("before"),
    },
    {
      "new.png": Buffer.from([0, 1]),
      "same.txt": Buffer.from("same"),
      "update.txt": Buffer.from("after"),
    },
  );
  assert.deepEqual(
    result.map((c) => [c.path, c.kind]),
    [
      ["new.png", "added"],
      ["old.txt", "deleted"],
      ["update.txt", "modified"],
    ],
  );
  assert.equal(result[0].binary, true);
});
test("runner reviews start.sh and rejects missing, empty or changed launchers", async t=>{
  const {store}=await fixture(t),runner=new Runner(store.codeDir);
  assert.match((await runner.info()).error!,/No start.sh/);
  await atomicWrite(store.codeDir,"start.sh","");assert.match((await runner.info()).error!,/empty/);
  await atomicWrite(store.codeDir,"start.sh","#!/bin/sh\necho hello\n");
  await assert.rejects(runner.start("wrong-hash"),/changed/);
});
test("logs are bounded and preview URLs are strictly loopback", () => {
  const logs: string[] = [];
  appendLog(logs, Array.from({ length: 450 }, (_, i) => String(i)).join("\n"));
  assert.equal(logs.length, 300);
  assert.equal(localUrl("http://localhost.evil.com:3000/"), undefined);
  assert.equal(localUrl("http://localhost@evil.com"), undefined);
  assert.equal(localUrl("http://127.0.0.1:5173"), "http://127.0.0.1:5173/");
  assert.equal(localUrl("https://example.org"), undefined);
});
test('block titles persist, export as headings and can be cleared without losing content', async t => {
  const {store,root}=await fixture(t);
  const doc=store.project.documents[0];
  const saved=await store.saveDocument(doc.id,{...doc,nodes:doc.nodes.map((node,index)=>({...node,title:index?'Colours':'Inspiration'}))});
  const reopened=new Store(root);await reopened.init();
  assert.deepEqual(reopened.project.documents.find(d=>d.id===doc.id),saved);
  const text=Object.values(markdown(reopened.project)).join('\n');
  assert.match(text,/## Inspiration\n\nTarget users:/);
  assert.match(text,/## Colours/);
  const cleared=await reopened.saveDocument(saved.id,{...saved,nodes:saved.nodes.map(node=>({...node,title:''}))});
  assert.equal(cleared.nodes.length,saved.nodes.length);
  assert.doesNotMatch(Object.values(markdown(reopened.project)).join('\n'),/## Inspiration/);
});


test("default sections resist deletion after restart while documents and custom sections remain removable", async t => {
  const { store } = await fixture(t);
  const reopened = new Store(store.root);
  await reopened.init();
  for (const section of reopened.project.sections) {
    const documents = reopened.project.documents.filter(d => d.sectionId === section.id);
    const before = await readSafe(reopened.dataDir, "project.json");
    await assert.rejects(reopened.deleteSection(section.id, documents), /Default sections cannot be deleted/);
    assert.deepEqual(await readSafe(reopened.dataDir, "project.json"), before);
    for (const doc of documents) await reopened.deleteDocument(doc.id, doc.version);
    await assert.rejects(reopened.deleteSection(section.id, []), /Default sections cannot be deleted/);
    assert.ok(await readSafe(reopened.skillDir, `skills/${section.slug}/SKILL.md`));
  }
  assert.equal(reopened.project.sections.length, 4);
  assert.equal(reopened.project.documents.length, 0);
  const custom = await reopened.addSection("Research");
  await reopened.deleteSection(custom.id, reopened.project.documents.filter(d => d.sectionId === custom.id));
  assert.equal(reopened.project.sections.length, 4);
  const again = new Store(store.root); await again.init();
  assert.deepEqual(again.project, reopened.project);
});
