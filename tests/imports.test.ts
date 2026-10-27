import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, paragraph } from "../server/store.js";
import { readSafe } from "../server/files.js";
import { prepareImports } from "../server/imports.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
  "base64",
);
const file = (name: string, data: string | Buffer) => ({
  name,
  base64: Buffer.from(data).toString("base64"),
});
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-import-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new Store(root);
  await store.init();
  return store;
}

test("section imports create filename documents with text/images and persist derived assets", async (t) => {
  const store = await fixture(t);
  const section = store.project.sections[0];
  const before = structuredClone(store.project);
  const { documents } = await store.importFiles({
    target: { kind: "section", id: section.id },
    files: [
      file(
        "Requirements.md",
        "# Heading\n\nKeep **raw Markdown**.\n<script>never execute</script>",
      ),
      file("Sketch.png", png),
      file("Empty.txt", ""),
    ],
  });
  assert.deepEqual(
    documents.map((doc) => doc.title),
    ["Requirements.md", "Sketch.png", "Empty.txt"],
  );
  assert.deepEqual(
    store.project.documents.slice(0, before.documents.length),
    before.documents,
  );
  assert.equal(documents[0].nodes[0].type, "text");
  assert.equal(documents[2].nodes[0].type, "text");
  assert.equal(documents[0].version, 0);
  const image = documents[1].nodes[0];
  assert.equal(image.type, "image");
  if (image.type !== "image") throw new Error("Expected image");
  assert.equal(image.alt, "Sketch.png");
  assert.deepEqual(documents[1].assetRefs, [image.assetId]);
  assert.deepEqual(
    await readSafe(store.dataDir, `assets/${image.assetId}`),
    png,
  );
  assert.match(
    (
      await readSafe(
        store.dataDir,
        `generated/${section.slug}/${documents[0].id}.md`,
      )
    ).toString(),
    /# Requirements\.md[\s\S]*Keep \*\*raw Markdown\*\*/,
  );
  const again = new Store(store.root);
  await again.init();
  assert.deepEqual(again.project, store.project);
  assert.deepEqual(await fs.readdir(store.codeDir), []);
  assert.equal(store.state.appliedSnapshotHash, null);
});

test("document imports append in file order, retain edits and title, and reject stale versions", async (t) => {
  const store = await fixture(t);
  const original = store.project.documents[0];
  const edited = await store.saveDocument(original.id, {
    ...original,
    title: "Existing title",
    nodes: [paragraph("Existing content")],
  });
  const imported = await store.importFiles({
    target: { kind: "document", id: edited.id, version: edited.version },
    files: [file("More.txt", "Additional text"), file("Sketch.png", png)],
  });
  const doc = imported.documents[0];
  assert.equal(doc.id, original.id);
  assert.equal(doc.title, "Existing title");
  assert.equal(doc.version, edited.version + 1);
  assert.deepEqual(doc.nodes[0], edited.nodes[0]);
  assert.deepEqual(
    doc.nodes.map((node) => node.type),
    ["text", "text", "image"],
  );
  assert.equal(store.project.documents.length, 4);
  const previous = structuredClone(store.project);
  await assert.rejects(
    store.importFiles({
      target: { kind: "document", id: doc.id, version: edited.version },
      files: [file("retry.txt", "Do not duplicate")],
    }),
    /changed elsewhere/,
  );
  assert.deepEqual(store.project, previous);
});

test("text imports preserve Unicode, UTF-16 and content beyond a single block", () => {
  const source = "a".repeat(39_999) + "😀\n" + "more text\n".repeat(5000);
  const [long, utf16, bom, plain] = prepareImports([
    file("long.md", source),
    file(
      "windows.txt",
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("Hello ✓\r\n", "utf16le"),
      ]),
    ),
    file("bom.txt", "\ufeffUTF-8"),
    file("README", "Extensionless text"),
  ]);
  assert.ok(long.nodes.length > 1);
  const joined = long.nodes
    .map((node) => (node.type === "text" ? node.text : ""))
    .join("");
  assert.equal(joined, source);
  for (const node of long.nodes)
    if (node.type === "text") {
      assert.ok(node.text.length <= 40_000);
      assert.equal(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(node.text),
        ),
        node.text,
      );
    }
  assert.equal(
    utf16.nodes[0].type === "text" && utf16.nodes[0].text,
    "Hello ✓\r\n",
  );
  assert.equal(bom.nodes[0].type === "text" && bom.nodes[0].text, "UTF-8");
  assert.equal(plain.nodes[0].type, "text");
});

test("imports reject unsafe names, binary data and invalid images without partial documents", async (t) => {
  const store = await fixture(t);
  const target = { kind: "section", id: store.project.sections[0].id };
  const previous = structuredClone(store.project);
  const disk = await readSafe(store.dataDir, "project.json");
  for (const invalid of [
    file("../escape.txt", "text"),
    file("C:\\escape.txt", "text"),
    file("bad\nname.txt", "text"),
    file("file.pdf", "%PDF-1.4"),
    file("fake.png", "Not an image"),
    file("fake.svg", "<html><svg></svg></html>"),
    file("binary.txt", Buffer.from([0, 1, 2, 3])),
    file("bad.txt", Buffer.from([0xff, 0x80])),
    { name: "bad.txt", base64: "not-base64!" },
  ]) {
    await assert.rejects(
      store.importFiles({
        target,
        files: [file("valid.md", "First file"), invalid],
      }),
    );
    assert.deepEqual(store.project, previous);
    assert.deepEqual(await readSafe(store.dataDir, "project.json"), disk);
  }
  await assert.rejects(store.importFiles({ target, files: [] }));
  await assert.rejects(
    store.importFiles({
      target: { kind: "section", id: "00000000-0000-4000-8000-000000000000" },
      files: [file("valid.txt", "hello")],
    }),
    /Section not found/,
  );
  assert.deepEqual(store.project, previous);
  assert.equal(
    (await fs.readdir(path.join(store.dataDir, "documents"))).length,
    4,
  );
});

test("imports have no batch, document, node or image-reference count caps", async (t) => {
  const store = await fixture(t);
  const section = await store.addSection("Imports");
  const files = Array.from({ length: 301 }, (_, index) =>
    file(
      `Image ${index}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${index + 1}" height="1"/>`,
    ),
  );
  const created = await store.importFiles({
    target: { kind: "section", id: section.id },
    files,
  });
  assert.equal(created.documents.length, 301);
  assert.equal(store.project.documents.length, 306);
  const original = store.project.documents.find(d => d.sectionId === section.id)!;
  const {
    documents: [appended],
  } = await store.importFiles({
    target: { kind: "document", id: original.id, version: original.version },
    files,
  });
  assert.equal(appended.nodes.length, original.nodes.length + 301);
  assert.equal(appended.assetRefs.length, 301);
  assert.equal(appended.nodes.at(-1)!.type, "image");
  await store.saveDocument(appended.id, {
    ...appended,
    title: "Still editable",
  });
  await store.addDocument(section.id, "Another document");
  const again = new Store(store.root);
  await again.init();
  assert.deepEqual(again.project, store.project);
  await again.deleteSection(
    section.id,
    again.project.documents
      .filter((doc) => doc.sectionId === section.id)
      .map(({ id, version }) => ({ id, version })),
  );
  assert.equal(again.project.documents.length, 4);
});

test("SVG imports retain their vector data and support common XML prologs and encodings", async (t) => {
  const store = await fixture(t);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
  for (const data of [
    Buffer.from(svg),
    Buffer.from(
      `\ufeff<?xml version="1.0"?><!-- exported -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg}`,
    ),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(svg, "utf16le")]),
  ]) {
    const {
      documents: [doc],
    } = await store.importFiles({
      target: { kind: "section", id: store.project.sections[0].id },
      files: [{ ...file("Drawing.SVG", data), resolution: { action: "keep_both" } }],
    });
    assert.equal(doc.nodes[0].type, "image");
    assert.match(doc.assetRefs[0], /^[a-f0-9]{64}\.svg$/);
    assert.deepEqual(
      await readSafe(store.dataDir, `assets/${doc.assetRefs[0]}`),
      data,
    );
    assert.equal(
      await store.saveImage(data.toString("base64")),
      doc.assetRefs[0],
    );
    assert.match(
      (
        await readSafe(store.dataDir, `generated/features/${doc.id}.md`)
      ).toString(),
      /!\[Drawing.SVG\]\(\.\.\/\.\.\/assets\/.*\.svg\)/,
    );
  }
  const again = new Store(store.root);
  await again.init();
  assert.deepEqual(again.project, store.project);
});

test("failed imports restore document mirrors and remove newly created document exports", async (t) => {
  const store = await fixture(t);
  const previous = structuredClone(store.project);
  const disk = await readSafe(store.dataDir, "project.json");
  const doc = store.project.documents[0];
  const section = store.project.sections[0];
  const originalMirror = await readSafe(
    store.dataDir,
    `documents/${doc.id}.json`,
  );
  const originalMarkdown = await readSafe(
    store.dataDir,
    `generated/${section.slug}/${doc.id}.md`,
  );
  t.mock.method(store, "saveProject", async () => {
    await store.exportDefinitions();
    throw new Error("Simulated persistence failure");
  });
  for (const target of [
    { kind: "section", id: section.id },
    { kind: "document", id: doc.id, version: doc.version },
  ]) {
    await assert.rejects(
      store.importFiles({
        target,
        files: [file("new.md", "New content"), file("Sketch.png", png)],
      }),
      /Simulated/,
    );
    assert.deepEqual(store.project, previous);
    assert.deepEqual(await readSafe(store.dataDir, "project.json"), disk);
    assert.deepEqual(
      await readSafe(store.dataDir, `documents/${doc.id}.json`),
      originalMirror,
    );
    assert.deepEqual(
      await readSafe(store.dataDir, `generated/${section.slug}/${doc.id}.md`),
      originalMarkdown,
    );
    assert.equal(
      (await fs.readdir(path.join(store.dataDir, "documents"))).length,
      4,
    );
    assert.equal(
      (await fs.readdir(path.join(store.dataDir, "generated", section.slug)))
        .length,
      1,
    );
  }
});
