import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Studio } from "../server/studio.js";
import { Store, paragraph } from "../server/store.js";
import { atomicWrite, changes, manifest, manifestHash } from "../server/files.js";
import { createHttpServer } from "../server/http.js";
import { debugFiles } from "../server/debug.js";
import type { PlanSession, Run, DebugFile } from "../shared/model.js";
import type { Pipeline } from "../shared/pipeline-history.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-removed-pipeline-"));
  const studio = new Studio(new Store(root));
  await studio.init();
  t.after(async () => { await studio.close(); await fs.rm(root, { recursive: true, force: true }); });
  return studio;
}
// Exercise the actual HTTP handler without requiring permission to bind sockets.
async function dispatch(app: ReturnType<typeof createHttpServer>, route: string, method = "GET", token?: string, payload: unknown = {}) {
  const req = Readable.from(method === "GET" ? [] : [Buffer.from(JSON.stringify(payload))]);
  Object.assign(req, { url: `/api${route}`, method, headers: {
    host: "127.0.0.1:4310", "content-type": "application/json", ...(token ? { "x-studio-token": token } : {}),
  } });
  let status = 200, content = "";
  const res = new Writable({ write(chunk, _encoding, callback) { content += chunk; callback(); } });
  Object.assign(res, { setHeader() {}, writeHead(code: number) { status = code; } });
  await new Promise<void>((resolve, reject) => {
    res.on("finish", resolve); res.on("error", reject);
    app.server.emit("request", req as IncomingMessage, res as unknown as ServerResponse);
  });
  return { status, body: JSON.parse(content) };
}

test("removed workflow endpoints cannot execute or mutate saved state, while editor routes still work", async t => {
  const studio = await fixture(t), app = createHttpServer(studio, process.cwd());
  const token = (await dispatch(app, "/bootstrap")).body.token;
  const before = JSON.stringify(studio.store.state), id = randomUUID();
  const routes = ["/plan", "/plan/retry", "/plan/regroup", "/discuss", "/execute", "/rebuild", "/refine", "/proposal", "/cancel", "/diff/reset",
    ...["continue", "accept", "dismiss", "proposal", "test-start"].map(action => `/drafts/${id}/${action}`), `/runs/${id}/replan`];
  for (const route of routes) {
    assert.equal((await dispatch(app, route, "POST")).status, 403, route);
    assert.equal((await dispatch(app, route, "POST", token)).status, 404, route);
  }
  assert.equal(JSON.stringify(studio.store.state), before);
  assert.equal(studio.busy, false);
  const doc = studio.store.project.documents[0];
  const saved = await dispatch(app, `/documents/${doc.id}`, "PUT", token, { ...doc, nodes: [paragraph("Keep this definition.")] });
  assert.equal(saved.status, 200);
  assert.equal(studio.store.project.documents[0].nodes[0].type, "text");
  assert.equal((await dispatch(app, "/settings", "POST", token, { model: null, reasoning: null })).status, 200);
  assert.equal((await dispatch(app, "/tree", "GET", token)).status, 200);
});

test("restart preserves old in-progress records, checkpoints and source without resuming or rewriting them", async t => {
  const studio = await fixture(t), store = studio.store;
  const snapshot = await store.snapshot(), sessionId = randomUUID(), runId = randomUUID(), pipelineId = randomUUID();
  const now = new Date().toISOString();
  const session: PlanSession = { id: sessionId, pipelineId, baseSnapshotHash: null, candidateSnapshotHash: snapshot.hash, snapshot,
    currentRevision: null, revisions: [], messages: [], status: "planning", logs: ["old planning"] };
  const base = { "existing.txt": Buffer.from("accepted") }, result = { "existing.txt": Buffer.from("draft") };
  await atomicWrite(store.codeDir, "existing.txt", base["existing.txt"]);
  const info = { runId, baseHash: manifestHash(base), resultHash: manifestHash(result), fileCount: 1 };
  const run: Run = { id: runId, sessionId, pipelineId, planRevisionId: randomUUID(), status: "running", tempWorkdir: "/unused",
    logs: ["old execution"], changedFiles: changes(base, result), createdAt: now, checkpoint: info };
  const pipeline: Pipeline = { id: pipelineId, sessionId, snapshotHash: snapshot.hash, sourceHash: info.baseHash, fingerprint: "saved", createdAt: now,
    updatedAt: now, status: "planning", units: [], tasks: [], requirements: [], steps: [] };
  const records: Record<string, unknown> = {
    [`plan-sessions/${sessionId}.json`]: session, [`runs/${runId}/run.json`]: run, [`pipelines/${pipelineId}/pipeline.json`]: pipeline,
    [`runs/${runId}/checkpoint.json`]: { info, base: { "existing.txt": base["existing.txt"].toString("base64") }, result: { "existing.txt": result["existing.txt"].toString("base64") } },
    "state.json": { ...store.state, sessionId, runId, checkpoint: info, draftRunId: runId },
  };
  for (const [file, data] of Object.entries(records)) await atomicWrite(store.dataDir, file, JSON.stringify(data));
  const reopened = new Studio(new Store(store.root));
  await reopened.init();
  t.after(() => reopened.close());
  assert.equal((await reopened.state()).busy, false);
  assert.equal(reopened.runner.state.status, "stopped");
  assert.deepEqual(reopened.run, run);
  assert.deepEqual(reopened.session, session);
  assert.deepEqual(await reopened.pipelines.get(pipelineId), pipeline);
  assert.equal((await reopened.pipelines.list()).length, 1);
  const saved = await debugFiles(reopened.store, reopened.session, "current", "saved-work/existing.txt") as DebugFile;
  assert.equal(saved.text, "draft");
  for (const [file, data] of Object.entries(records)) assert.equal(await fs.readFile(path.join(store.dataDir, file), "utf8"), JSON.stringify(data), file);
  assert.equal(manifestHash(await manifest(store.codeDir)), info.baseHash);
  await assert.rejects(reopened.pipelines.get("../private"), /Invalid pipeline/);
});

test("stopping preview startup creates no repair run", async t => {
  const studio = await fixture(t);
  await atomicWrite(studio.store.codeDir, "start.sh", "#!/bin/sh\nexit 1\n");
  const script = (await studio.runner.info()).scriptHash!;
  await studio.startProject(script);
  // Stop also joins launch preparation and must never launch repair work.
  await studio.stopProject();
  assert.equal(studio.run, null);
  assert.equal(studio.session, null);
  assert.deepEqual(await studio.store.runs(), []);
  assert.equal(studio.busy, false);
});

test("fixed workflow HTTP controls require authorization and expose saved live attempts", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-workflow-http-"));
  const studio = new Studio(new Store(root), {
    async status() { return { available: true }; },
    async run(call) {
      call.onSession(call.sessionId ?? randomUUID()); call.onEvent("live event");
      if (call.writable) await atomicWrite(call.cwd, "app.txt", "built");
      return { status: "completed", summary: "done", requirements: [], findings: [] };
    },
  });
  await studio.init();
  t.after(async () => { await studio.close(); await fs.rm(root, { recursive: true, force: true }); });
  const app = createHttpServer(studio, process.cwd());
  const token = (await dispatch(app, "/bootstrap")).body.token;
  const input = { fullSpec: false, source: "project" };
  assert.equal((await dispatch(app, "/workflows", "POST", undefined, input)).status, 403);
  const created = await dispatch(app, "/workflows", "POST", token, input);
  assert.equal(created.status, 200);
  await studio.workflows.waitForIdle();
  const detail = await dispatch(app, `/workflows/${created.body.id}`, "GET", token);
  assert.equal(detail.body.status, "accepted");
  assert.ok(detail.body.stages[0].attempts[0].prompt.includes("/changes/index.json"));
  assert.equal(detail.body.snapshot, undefined);
  assert.equal((await dispatch(app, `/workflows/${created.body.id}/file?path=AGENTS.md`, "GET", token)).status, 200);
  assert.equal((await dispatch(app, `/workflows/${created.body.id}/file?path=../../state.json`, "GET", token)).status, 404);
  const events = await dispatch(app, `/workflows/${created.body.id}/events?stage=building-first-project&attempt=1`, "GET", token);
  assert.match(events.body.text, /live event/);
  assert.equal(detail.body.acceptancePolicy,"automatic");
  assert.equal((await manifest(studio.store.codeDir))["app.txt"].toString(), "built");
});
