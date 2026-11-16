import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlockAI, imageBlockProposal, parseBlockProposal } from "../server/block-ai.js";
import { Store } from "../server/store.js";
import type { CodingAgent } from "../server/codex-cli.js";
import type { DocNode } from "../shared/model.js";

const block: DocNode = { id: "target", type: "text", title: "Requirements", text: "Original", bold: true, italic: false, color: "blue" };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>';
const completed = (summary: string) => ({ status: "completed" as const, summary, requirements: [], findings: [] });

test("block AI validates content and retains block identity and formatting", () => {
  assert.deepEqual(parseBlockProposal('{"text":"Revised"}', block).node, { ...block, text: "Revised" });
  assert.deepEqual(parseBlockProposal('{"items":["First","Second"]}', { id: "list", type: "list", items: [""], ordered: true }).node, { id: "list", type: "list", items: ["First", "Second"], ordered: true });
  assert.throws(() => parseBlockProposal('{"text":"Revised","id":"different"}', block), /does not fit/);
  assert.throws(() => parseBlockProposal("not JSON", block), /invalid content/);
  assert.throws(() => parseBlockProposal('{"rows":[["a","b"],["c"]]}', { id: "table", type: "table", rows: [[""]] }), /uneven/);
  assert.throws(() => parseBlockProposal('{"items":[]}', { id: "list", type: "list", items: [""], ordered: false }), /does not fit/);
});

test("generated SVG assets are content addressed and reject active or external content", () => {
  const proposal = imageBlockProposal(Buffer.from(svg), "Blue circle", null);
  assert.equal(proposal.node.type, "image");
  if (proposal.node.type !== "image") return;
  assert.match(proposal.node.assetId, /^[a-f0-9]{64}\.svg$/);
  assert.equal(Buffer.from(proposal.imageBase64!, "base64").toString(), svg);
  for (const unsafe of [
    svg.replace("<circle", '<script>alert(1)</script><circle'),
    svg.replace("<circle", '<image href="https://example.com/image.png"/><circle'),
    svg.replace("<circle", '<foreignObject><div>HTML</div></foreignObject><circle'),
    svg.replace("<circle", '<circle onload="alert(1)"/><circle'),
    svg.replace('fill="blue"', 'fill="url(https://example.com/image)"'),
  ]) assert.throws(() => imageBlockProposal(Buffer.from(unsafe), "Unsafe", null), /unsupported SVG/);
});

test("generation uses isolated read-only context, selected settings, and never saves definitions or assets", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-ai-test-"));
  const store = new Store(root); await store.init();
  const document = store.project.documents[0];
  let scratch = "";
  const before = JSON.stringify(store.project);
  const settings = { provider: "claude" as const, model: "test-model", reasoning: null };
  store.settings = settings;
  const agent: CodingAgent = { async status() { return { available: true }; }, async run(call) {
    scratch = call.cwd;
    assert.notEqual(call.cwd, store.root);
    assert.equal(call.writable, false);
    assert.equal(call.skipGitRepoCheck, true);
    assert.deepEqual(call.settings, settings);
    assert.ok(!call.prompt.includes("Original"));
    const context = JSON.parse(await fs.readFile(path.join(call.cwd, "context.json"), "utf8"));
    assert.equal(context.block.text, "Original");
    assert.equal(context.request, "Make this clearer");
    return completed('{"text":"Improved"}');
  } };
  const service = new BlockAI(store, agent);
  t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const result = await service.generate({ document, block, prompt: "Make this clearer" }, new AbortController().signal);
  assert.equal(result.node.type === "text" && result.node.text, "Improved");
  assert.equal(JSON.stringify(store.project), before);
  await assert.rejects(fs.stat(scratch), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(store.dataDir, "assets")), { code: "ENOENT" });
  await assert.rejects(service.generate({ document: { ...document, sectionId: "missing" }, block, prompt: "Write" }, new AbortController().signal), /Document not found/);
});

test("cancellation stops the request, rejects overlapping calls, cleans scratch and allows retry", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-ai-cancel-"));
  const store = new Store(root); await store.init();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let scratch = "", calls = 0;
  const service = new BlockAI(store, { async status() { return { available: true }; }, async run(call) {
    if (++calls > 1) return completed('{"text":"Retry"}');
    scratch = call.cwd; started();
    await new Promise<void>((_resolve, reject) => { call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true }); });
    return completed("unused");
  } });
  t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const request = { document: store.project.documents[0], block, prompt: "Write" };
  const controller = new AbortController();
  const pending = service.generate(request, controller.signal);
  const rejection = assert.rejects(pending, /cancelled/);
  await ready;
  await assert.rejects(service.generate(request, new AbortController().signal), /Another block request/);
  controller.abort(); await rejection;
  await assert.rejects(fs.stat(scratch), { code: "ENOENT" });
  assert.equal((await service.generate(request, new AbortController().signal)).node.type, "text");
});

test("HTTP block requests leave the mutation queue available and require the local token", async t => {
  const { Studio } = await import("../server/studio.js");
  const { createHttpServer } = await import("../server/http.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-ai-http-"));
  let started!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  const studio = new Studio(new Store(root), { async status() { return { available: true }; }, async run() {
    started(); await release; return completed('{"text":"Suggested"}');
  } });
  await studio.init();
  const app = createHttpServer(studio, process.cwd());
  const port = await app.listen(0), base = `http://127.0.0.1:${port}`;
  t.after(async () => { finish(); await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const { token } = await (await fetch(`${base}/api/bootstrap`)).json() as { token: string };
  const headers = { "X-Studio-Token": token, "Content-Type": "application/json" };
  const document = structuredClone(studio.store.project.documents[0]);
  const input = { document, block, prompt: "Write" };
  assert.equal((await fetch(`${base}/api/block-ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).status, 403);
  const pending = fetch(`${base}/api/block-ai`, { method: "POST", headers, body: JSON.stringify(input) });
  await ready;
  const save = await fetch(`${base}/api/documents/${document.id}`, { method: "PUT", headers, body: JSON.stringify({ ...document, title: "Saved while AI is working" }), signal: AbortSignal.timeout(5000) });
  assert.equal(save.status, 200);
  finish();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { node: { text: string } }).node.text, "Suggested");
  assert.equal(studio.store.project.documents[0].title, "Saved while AI is working");
  assert.deepEqual(studio.store.project.documents[0].nodes, document.nodes);
});

test("Claude image requests are blocked before invoking AI while text and other providers remain available", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-ai-provider-"));
  const store = new Store(root); await store.init();
  let calls = 0;
  const service = new BlockAI(store, { async status() { return { available: true }; }, async run(call) {
    calls++;
    assert.equal(call.writable, true);
    assert.equal(call.browser, false);
    assert.doesNotMatch(call.prompt, /SVG|PNG|JPEG|WebP|illustration|viewBox/);
    await fs.writeFile(path.join(call.cwd, "image.svg"), svg);
    return completed(JSON.stringify({ imagePath: "image.svg", alt: "Blue circle" }));
  } });
  t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const document = store.project.documents[0];
  store.settings = { provider: "claude", model: null, reasoning: null };
  for (const target of [null, { id: "image", type: "image" as const, assetId: `${"a".repeat(64)}.png`, alt: "Existing image" }]) {
    await assert.rejects(service.generate({ document, block: target, prompt: "Draw a circle" }, new AbortController().signal), error => {
      assert.match((error as Error).message, /Image generation is unavailable with Claude.*Settings/);
      assert.equal((error as { status: number }).status, 400);
      return true;
    });
  }
  assert.equal(calls, 0);
  for (const provider of ["codex", "gemini"] as const) {
    store.settings = { provider, model: null, reasoning: null };
    assert.equal((await service.generate({ document, block: null, prompt: "Draw a circle" }, new AbortController().signal)).node.type, "image");
  }
  assert.equal(calls, 2);
});

test("image requests import the generated file by its content, preserve existing block identity, and surface missing tools", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-ai-files-"));
  const store = new Store(root); await store.init();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=", "base64");
  const originalAsset = await store.saveImage(png.toString("base64"));
  const original: DocNode = { id: "existing-image", title: "User title", type: "image", assetId: originalAsset, alt: "Original" };
  let response: { imagePath: string; alt: string } | { error: string } = { imagePath: "output.asset", alt: "Generated photo" };
  let scratch = "";
  const service = new BlockAI(store, { async status() { return { available: true }; }, async run(call) {
    scratch = call.cwd;
    const context = JSON.parse(await fs.readFile(path.join(scratch, "context.json"), "utf8"));
    assert.equal(context.request, "Create a photo of a cat");
    assert.ok((await fs.readFile(path.join(scratch, context.currentImage))).equals(png));
    await fs.writeFile(path.join(scratch, "output.asset"), png);
    return completed(JSON.stringify(response));
  } });
  t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const request = { document: store.project.documents[0], block: original, prompt: "Create a photo of a cat" };
  const proposal = await service.generate(request, new AbortController().signal);
  assert.equal(proposal.node.id, original.id);
  assert.equal(proposal.node.title, original.title);
  assert.equal(proposal.node.type === "image" && proposal.node.assetId.endsWith(".png"), true);
  assert.ok(Buffer.from(proposal.imageBase64!, "base64").equals(png));
  await assert.rejects(fs.stat(scratch), { code: "ENOENT" });
  response = { error: "No image-generation tool is configured for this provider." };
  await assert.rejects(service.generate(request, new AbortController().signal), /No image-generation tool is configured/);
  response = { imagePath: "../outside.png", alt: "Invalid" };
  await assert.rejects(service.generate(request, new AbortController().signal));
});
