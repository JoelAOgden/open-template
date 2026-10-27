import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const createSnapshot = createRequire(import.meta.url)('../scripts/release-snapshot.cjs');
function fixture(initial: Record<string, string> = {}) {
  const refs = new Map(Object.entries(initial));
  const created: string[] = [];
  const context = { eventName: 'push', ref: 'refs/heads/release', sha: 'a'.repeat(40), repo: { owner: 'owner', repo: 'repo' } };
  const github = { rest: { git: {
    async getRef({ ref }: { ref: string }) {
      if (!refs.has(ref)) throw Object.assign(new Error('Not found'), { status: 404 });
      return { data: { object: { sha: refs.get(ref) } } };
    },
    async createRef({ ref, sha }: { ref: string; sha: string }) {
      created.push(ref); refs.set(ref.replace(/^refs\//, ''), sha);
    },
  } } };
  return { refs, created, args: { github, context, version: '0.1.0', runAttempt: '1' } };
}
test('release merge creates a snapshot of the exact commit without updating tags', async () => {
  const { args, refs, created } = fixture();
  assert.deepEqual(await createSnapshot(args), { version: '0.1.0', branch: 'releases/0.1.0', commit: args.context.sha });
  assert.deepEqual(created, ['refs/heads/releases/0.1.0']);
  assert.equal(refs.get('heads/releases/0.1.0'), args.context.sha);
  assert.equal(refs.has('tags/v0.1.0'), false);
});
test('snapshot pushes, main pushes and pull requests cannot create a release snapshot', async () => {
  for (const [eventName, ref] of [['push', 'refs/heads/releases/0.1.0'], ['push', 'refs/heads/main'], ['pull_request', 'refs/heads/release']]) {
    const { args, created } = fixture();
    args.context.eventName = eventName; args.context.ref = ref;
    await assert.rejects(createSnapshot(args), /only originate/);
    assert.equal(created.length, 0);
  }
});
test('existing versions reject new runs while retries reuse only the exact saved commit', async () => {
  const { args, created } = fixture({ 'heads/releases/0.1.0': 'a'.repeat(40) });
  await assert.rejects(createSnapshot(args), /Retry the original/);
  args.runAttempt = '2';
  assert.equal((await createSnapshot(args)).branch, 'releases/0.1.0');
  args.context.sha = 'b'.repeat(40);
  await assert.rejects(createSnapshot(args), /another commit/);
  assert.equal(created.length, 0);
});
test('published tags and API permission failures stop snapshot creation', async () => {
  const existing = fixture({ 'tags/v0.1.0': 'a'.repeat(40) });
  await assert.rejects(createSnapshot(existing.args), /already exists/);
  assert.equal(existing.created.length, 0);
  const failed = fixture();
  failed.args.github.rest.git.getRef = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  await assert.rejects(createSnapshot(failed.args), /Forbidden/);
  assert.equal(failed.created.length, 0);
});
