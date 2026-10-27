import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.js';
import { Store, paragraph } from '../server/store.js';
import { atomicWrite, manifest } from '../server/files.js';
import type { CodingAgent, CodexCall } from '../server/codex-cli.js';
import { definitionDiff } from '../server/definition-context.js';
import { sectionsForDiff } from '../server/workflow.js';
import { selectPipeline } from '../server/workflow/selection.js';
const options = { fullSpec: false, source: 'project' as const };
async function fixture(t: test.TestContext, hook?: (call: CodexCall) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-auto-'));
  const agent: CodingAgent = { status: async () => ({ available: true }), run: async call => { await hook?.(call); call.signal.throwIfAborted(); await atomicWrite(call.cwd, 'result.txt', 'implemented'); return { status: 'completed', summary: 'Done', requirements: [], findings: [] }; } };
  const studio = new Studio(new Store(root), agent); await studio.init();
  for (const doc of studio.store.project.documents.slice(0, 2)) await studio.store.saveDocument(doc.id, { ...doc, nodes: [paragraph('Original requirement')] });
  t.after(async () => { await studio.close(); await fs.rm(root, { recursive: true, force: true }); }); return { studio, root };
}
test('new projects auto-apply once and can restore their exact baseline without deleting definitions', async t => {
  const { studio } = await fixture(t); const before = await studio.store.snapshot(); const view = await studio.workflows.create(options); await studio.workflows.waitForIdle();
  assert.equal(view.pipelineMode, 'first-project'); assert.equal(view.stages[0].title, 'Building your project'); assert.equal(studio.workflows.active!.status, 'accepted', studio.workflows.active!.error);
  assert.equal((await manifest(studio.store.codeDir))['result.txt'].toString(), 'implemented'); assert.equal(studio.store.state.appliedSnapshotHash, before.hash);
  await studio.workflows.rollback(view.id); assert.equal(studio.workflows.active!.rolledBack, true); assert.equal((await studio.store.snapshot()).hash, before.hash); assert.equal(Object.keys(await manifest(studio.store.codeDir)).length, 0);
});
test('selection uses distinct section ownership and 19/20 added content lines', async t => {
  const { studio } = await fixture(t); const before = await studio.store.snapshot();
  const choose = (lines: number, single = false) => {
    const after = structuredClone(before); after.project.documents[0].nodes = [paragraph('Original requirement\n' + Array.from({ length: lines - (single ? 0 : 1) }, (_, i) => `New requirement ${i}`).join('\n'))];
    if (!single) after.project.documents[1].nodes = [paragraph('Original requirement\nSecond section change')];
    const diff = definitionDiff(before, after); return selectPipeline(before, after, diff, sectionsForDiff(after, before, diff), true, false);
  };
  assert.equal(choose(19).stats.added, 19); assert.equal(choose(19).mode, 'small-update'); assert.deepEqual(choose(19).stages.map(s => s.title), ['Implementing Changes']);
  assert.equal(choose(20).mode, 'multi-section'); assert.equal(choose(30, true).mode, 'single-section');
});
test('large deletions and full-spec requests never take the small-update shortcut', async t => {
  const { studio } = await fixture(t); const before = await studio.store.snapshot(); before.project.documents[0].nodes = [paragraph(Array.from({ length: 25 }, (_, i) => `Requirement ${i}`).join('\n'))];
  const after = structuredClone(before); after.project.documents[0].nodes = [paragraph('Replacement')]; after.project.documents[1].nodes = [paragraph('Changed')];
  const diff = definitionDiff(before, after), sections = sectionsForDiff(after, before, diff);
  assert.equal(selectPipeline(before, after, diff, sections, true, false).mode, 'multi-section'); assert.equal(selectPipeline(before, after, diff, sections, true, true).mode, 'multi-section');
});
test('cancel discards run-owned output and checkpoints and cannot resume or change live source', async t => {
  let reached!: () => void; const ready = new Promise<void>(resolve => reached = resolve);
  const { studio } = await fixture(t, async call => { await atomicWrite(call.cwd, 'partial.txt', 'discard'); reached(); await new Promise<void>(resolve => call.signal.addEventListener('abort', () => resolve(), { once: true })); });
  const view = await studio.workflows.create(options); await ready; await studio.workflows.cancel(view.id);
  assert.equal(studio.workflows.active!.cancelled, true); assert.equal(Object.keys(await manifest(studio.store.codeDir)).length, 0);
  await assert.rejects(fs.access(path.join(studio.store.dataDir, 'workflows', view.id, 'project', 'output')));
  await assert.rejects(studio.workflows.resume(view.id), /cannot be resumed/);
});
test('external source edits prevent automatic application and retain the completed draft', async t => {
  let edited = false; const { studio } = await fixture(t, async () => { if (!edited) { edited = true; await atomicWrite(studio.store.codeDir, 'external.txt', 'keep'); } });
  await studio.workflows.create(options); await studio.workflows.waitForIdle(); assert.equal(studio.workflows.active!.status, 'failed'); assert.match(studio.workflows.active!.error!, /baseline changed/);
  assert.equal((await manifest(studio.store.codeDir))['external.txt'].toString(), 'keep'); assert.equal((await manifest(studio.store.codeDir))['result.txt'], undefined);
});
test('rollback refuses subsequent source edits', async t => {
  const { studio } = await fixture(t); const view = await studio.workflows.create(options); await studio.workflows.waitForIdle(); await atomicWrite(studio.store.codeDir, 'result.txt', 'user edit');
  await assert.rejects(studio.workflows.rollback(view.id), /overwrite newer work/); assert.equal((await manifest(studio.store.codeDir))['result.txt'].toString(), 'user edit');
});
test('queued cancellation wins before automatic application begins', async t => {
  const { studio } = await fixture(t); let release!: () => void, reached!: () => void;
  const queued = new Promise<void>(resolve => reached = resolve), gate = new Promise<void>(resolve => release = resolve);
  studio.workflows.mutateDefinitions = async operation => { reached(); await gate; return operation(); };
  const view = await studio.workflows.create(options); await queued; const cancellation = studio.workflows.cancel(view.id); release(); await cancellation;
  assert.equal(studio.workflows.active!.cancelled, true); assert.equal(Object.keys(await manifest(studio.store.codeDir)).length, 0);
});

test('interrupted automatic application restores the prior source and does not silently restart paid work', async t => {
  const { studio, root } = await fixture(t); await atomicWrite(studio.store.codeDir, 'existing.txt', 'original');
  const view = await studio.workflows.create(options); await studio.workflows.waitForIdle();
  const active = studio.workflows.active!; const prior = JSON.parse(await fs.readFile(path.join(studio.store.dataDir, 'workflows', view.id, 'prior-state.json'), 'utf8'));
  active.status = 'review'; active.applying = true;
  await atomicWrite(studio.store.dataDir, `workflows/${view.id}/workflow.json`, JSON.stringify(active));
  await atomicWrite(studio.store.dataDir, `workflows/${view.id}/accepting.json`, JSON.stringify({ prior }));
  const recovered = new Studio(new Store(root), { status: async () => ({ available: true }), run: async () => { throw new Error('Must not resume automatically'); } }); await recovered.init(); t.after(() => recovered.close());
  assert.equal((await manifest(recovered.store.codeDir))['existing.txt'].toString(), 'original'); assert.equal((await manifest(recovered.store.codeDir))['result.txt'], undefined);
  assert.equal(recovered.workflows.active!.status, 'review'); assert.equal(recovered.workflows.active!.applying, false); assert.equal(recovered.store.state.appliedSnapshotHash, prior.appliedSnapshotHash);
});
test('restart completes a durable cancellation request instead of preserving a resumable draft', async t => {
  const { studio, root } = await fixture(t); const view = await studio.workflows.create({ ...options, acceptancePolicy: 'manual' }); await studio.workflows.waitForIdle();
  const active = studio.workflows.active!; active.cancellationRequested = true; await atomicWrite(studio.store.dataDir, `workflows/${view.id}/workflow.json`, JSON.stringify(active));
  const recovered = new Studio(new Store(root)); await recovered.init(); t.after(() => recovered.close());
  assert.equal(recovered.workflows.active!.cancelled, true); assert.equal(recovered.workflows.active!.status, 'dismissed');
  await assert.rejects(fs.access(path.join(studio.store.dataDir, 'workflows', view.id, 'project', 'output')));
});
test('restart during rollback restores the applied version unless restoration was committed', async t => {
  const { studio, root } = await fixture(t); const view = await studio.workflows.create(options); await studio.workflows.waitForIdle();
  const prior = { ...studio.store.state }; await atomicWrite(studio.store.dataDir, `workflows/${view.id}/restoring.json`, JSON.stringify({ prior }));
  await fs.rm(path.join(studio.store.codeDir, 'result.txt'));
  const recovered = new Studio(new Store(root)); await recovered.init(); t.after(() => recovered.close());
  assert.equal((await manifest(recovered.store.codeDir))['result.txt'].toString(), 'implemented'); assert.equal(recovered.workflows.active!.status, 'accepted');
});
test('small multi-section updates execute one dedicated prompt and preserve it through a pause', async t => {
  const { studio } = await fixture(t); await studio.workflows.create(options); await studio.workflows.waitForIdle();
  for (const doc of studio.store.project.documents.slice(0, 2)) await studio.store.saveDocument(doc.id, { ...doc, nodes: [paragraph('Original requirement\nSmall addition')] });
  const view = await studio.workflows.create(options); await studio.workflows.waitForIdle();
  assert.equal(view.pipelineMode, 'small-update'); assert.equal(view.stages.length, 1); assert.equal(view.stages[0].nodeType, 'implementing-changes');
  const active = studio.workflows.active!; assert.match(active.stages[0].attempts[0].prompt, /only implementation call/); assert.doesNotMatch(active.stages[0].attempts[0].prompt, /Later section passes/); assert.equal(active.status, 'accepted');
});
