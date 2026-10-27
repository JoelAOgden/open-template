import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const createSnapshot = createRequire(import.meta.url)('../scripts/release-snapshot.cjs');
const manifests = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
type Commit = { message: string; parents: { sha: string }[]; tree: { sha: string } };
type TreeEntry = { path: string; mode: string; type: string; content: string };
async function fixture(initial: Record<string, string> = {}) {
  const refs = new Map(Object.entries(initial));
  const created: string[] = [];
  const commits = new Map<string, Commit>();
  const trees: { base_tree: string; tree: TreeEntry[] }[] = [];
  const blobs = new Map(await Promise.all(manifests.map(async file => [file, await fs.readFile(file, 'utf8')] as const)));
  const context = { eventName: 'push', ref: 'refs/heads/release', sha: 'a'.repeat(40), runId: 123, repo: { owner: 'owner', repo: 'repo' } };
  commits.set(context.sha, { message: 'Merged PR', parents: [], tree: { sha: 'source-tree' } });
  const github = {
    async paginate(_method: unknown, { ref }: { ref: string }) {
      return [...refs].filter(([name]) => name.startsWith(ref)).map(([name, sha]) => ({ ref: `refs/${name}`, object: { sha } }));
    },
    rest: { git: {
      listMatchingRefs() {},
      async getCommit({ commit_sha }: { commit_sha: string }) {
        return { data: commits.get(commit_sha) ?? { message: 'Older release', parents: [], tree: { sha: 'older-tree' } } };
      },
      async getTree() { return { data: { truncated: false, tree: manifests.map(file => ({ path: file, type: 'blob', mode: '100644', sha: file })) } }; },
      async getBlob({ file_sha }: { file_sha: string }) { return { data: { encoding: 'base64', content: Buffer.from(blobs.get(file_sha)!).toString('base64') } }; },
      async createTree(args: { base_tree: string; tree: TreeEntry[] }) { trees.push(args); return { data: { sha: `tree-${trees.length}` } }; },
      async createCommit({ message, tree, parents }: { message: string; tree: string; parents: string[] }) {
        const sha = `snapshot-${commits.size}`;
        commits.set(sha, { message, tree: { sha: tree }, parents: parents.map(sha => ({ sha })) });
        return { data: { sha } };
      },
      async createRef({ ref, sha }: { ref: string; sha: string }) {
        const key = ref.replace(/^refs\//, '');
        if (refs.has(key)) throw new Error('Reference already exists');
        created.push(ref); refs.set(key, sha);
      },
    } },
  };
  return { refs, created, commits, trees, blobs, args: { github, context, version: '0.1.0' } };
}
test('release snapshot bumps past published tags and reserved branches, synchronizing all manifests', async () => {
  const f = await fixture({ 'tags/v0.1.0': 'old', 'heads/releases/0.1.2': 'failed-build' });
  const snapshot = await createSnapshot(f.args);
  assert.equal(snapshot.version, '0.1.3');
  assert.equal(snapshot.branch, 'releases/0.1.3');
  assert.notEqual(snapshot.commit, f.args.context.sha);
  assert.deepEqual(f.commits.get(snapshot.commit)?.parents, [{ sha: f.args.context.sha }]);
  assert.equal(f.trees[0].base_tree, 'source-tree');
  assert.deepEqual(f.trees[0].tree.map(entry => entry.path), manifests);
  for (const entry of f.trees[0].tree) {
    if (entry.path.endsWith('.json')) {
      const data = JSON.parse(entry.content);
      assert.equal(data.version, snapshot.version);
      if (data.packages) assert.equal(data.packages[''].version, snapshot.version);
    } else assert.match(entry.content, /version = "0\.1\.3"/);
  }
  assert.deepEqual(f.created, ['refs/heads/releases/0.1.3']);
  assert.equal(f.refs.get('tags/v0.1.0'), 'old');
});
test('first release uses the configured starting version', async () => {
  const f = await fixture();
  assert.equal((await createSnapshot(f.args)).version, '0.1.0');
});
test('retries reuse the same version commit even after newer releases', async () => {
  const f = await fixture();
  const first = await createSnapshot(f.args);
  f.refs.set('tags/v0.9.0', 'newer-release');
  assert.deepEqual(await createSnapshot(f.args), first);
  assert.equal(f.created.length, 1);
  assert.equal(f.trees.length, 1);
  f.args.context.runId++;
  assert.equal((await createSnapshot(f.args)).version, '0.9.1');
});
test('snapshot pushes, main pushes and PR events cannot allocate versions', async () => {
  for (const [eventName, ref] of [['push', 'refs/heads/releases/0.1.0'], ['push', 'refs/heads/main'], ['pull_request', 'refs/heads/release']]) {
    const f = await fixture();
    Object.assign(f.args.context, { eventName, ref });
    await assert.rejects(createSnapshot(f.args), /only originate/);
    assert.equal(f.trees.length, 0);
  }
});
test('API permission errors and invalid manifests fail without creating snapshots', async () => {
  const f = await fixture();
  f.args.github.paginate = async () => { throw new Error('Forbidden'); };
  await assert.rejects(createSnapshot(f.args), /Forbidden/);
  assert.equal(f.created.length, 0);
  const broken = await fixture();
  broken.blobs.set('src-tauri/Cargo.lock', 'invalid');
  await assert.rejects(createSnapshot(broken.args), /Cannot find app version/);
  assert.equal(broken.trees.length, 0);
});
test('snapshot collisions fail without overwriting the existing branch', async () => {
  const f = await fixture();
  f.args.github.rest.git.createRef = async () => { throw new Error('Reference already exists'); };
  await assert.rejects(createSnapshot(f.args), /Reference already exists/);
  assert.equal(f.created.length, 0);
});
test('version selection compares numeric versions and supports intentional version jumps and prereleases', () => {
  assert.equal(createSnapshot.nextVersion('0.1.0', ['0.1.9', '0.1.10', 'nonsense']), '0.1.11');
  assert.equal(createSnapshot.nextVersion('1.0.0', ['0.9.9']), '1.0.0');
  assert.equal(createSnapshot.nextVersion('0.2.0-beta.1', ['0.2.0-beta.1', '0.2.0-beta.2']), '0.2.0-beta.3');
  assert.equal(createSnapshot.nextVersion('0.2.0-beta', ['0.2.0-beta']), '0.2.0-beta.1');
});
