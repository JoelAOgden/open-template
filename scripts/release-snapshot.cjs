const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const manifests = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function nextVersion(base, versions) {
  const match = base.match(semver);
  if (!match) throw new Error('Invalid release version.');
  const used = new Set(versions);
  if (match[4]) {
    let candidate = base;
    while (used.has(candidate)) {
      candidate = /\.\d+$/.test(candidate)
        ? candidate.replace(/\.(\d+)$/, (_, n) => `.${BigInt(n) + 1n}`)
        : `${candidate}.1`;
    }
    return candidate;
  }
  let highest;
  const compare = (a, b) => {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
  };
  for (const version of versions) {
    const parsed = version.match(semver);
    if (!parsed || parsed[4]) continue;
    const parts = parsed.slice(1, 4).map(BigInt);
    if (!highest || compare(parts, highest) > 0) highest = parts;
  }
  const minimum = match.slice(1, 4).map(BigInt);
  if (!highest || compare(minimum, highest) > 0) return base;
  return `${highest[0]}.${highest[1]}.${highest[2] + 1n}`;
}

// Only a release-branch push can allocate a snapshot. Never update release itself.
module.exports = async function createReleaseSnapshot({ github, context, version, root = process.cwd() }) {
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/release') {
    throw new Error('Release snapshots can only originate from a push to release.');
  }
  if (!semver.test(version)) throw new Error('Invalid release version.');
  if (!context.runId) throw new Error('A workflow run ID is required for retry-safe snapshots.');
  const refs = (await Promise.all(['heads/releases/', 'tags/v'].map(ref =>
    github.paginate(github.rest.git.listMatchingRefs, { ...context.repo, ref })
  ))).flat();
  const marker = `Open-template release run: ${context.runId}\nSource: ${context.sha}`;
  // A rerun reuses its version even if other releases happened meanwhile.
  for (const ref of refs.filter(ref => ref.ref.startsWith('refs/heads/releases/'))) {
    const savedVersion = ref.ref.slice('refs/heads/releases/'.length);
    if (!semver.test(savedVersion)) continue;
    const { data: commit } = await github.rest.git.getCommit({ ...context.repo, commit_sha: ref.object.sha });
    if (!commit.message.endsWith(`\n\n${marker}`)) continue;
    if (commit.parents.length !== 1 || commit.parents[0].sha !== context.sha) {
      throw new Error('Saved release snapshot has an unexpected source commit.');
    }
    return { version: savedVersion, branch: `releases/${savedVersion}`, commit: ref.object.sha };
  }
  const versions = refs.map(ref => ref.ref.replace(/^refs\/(?:heads\/releases\/|tags\/v)/, ''));
  const selected = nextVersion(version, versions);
  // Read manifests from the event commit, not a possibly newer checkout.
  const { data: source } = await github.rest.git.getCommit({ ...context.repo, commit_sha: context.sha });
  const { data: sourceTree } = await github.rest.git.getTree({ ...context.repo, tree_sha: source.tree.sha, recursive: '1' });
  if (sourceTree.truncated) throw new Error('Source tree is truncated; cannot safely create a release snapshot.');
  const entries = [];
  for (const file of manifests) {
    const entry = sourceTree.tree.find(entry => entry.path === file);
    if (!entry || entry.type !== 'blob' || entry.mode !== '100644') throw new Error(`Missing or invalid release manifest: ${file}`);
    const { data: blob } = await github.rest.git.getBlob({ ...context.repo, file_sha: entry.sha });
    if (blob.encoding !== 'base64') throw new Error(`Unsupported manifest encoding: ${file}`);
    entries.push({ file, content: Buffer.from(blob.content, 'base64') });
  }
  const temporary = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'open-template-snapshot-'));
  let tree;
  try {
    for (const entry of entries) {
      await fs.mkdir(path.dirname(path.join(temporary, entry.file)), { recursive: true });
      await fs.writeFile(path.join(temporary, entry.file), entry.content);
    }
    const script = path.join(root, 'scripts/release-version.mjs');
    await exec(process.execPath, [script, 'set', selected], { cwd: temporary });
    await exec(process.execPath, [script, 'check', `v${selected}`], { cwd: temporary });
    tree = await Promise.all(manifests.map(async file => ({ path: file, mode: '100644', type: 'blob', content: await fs.readFile(path.join(temporary, file), 'utf8') })));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  const { data: updatedTree } = await github.rest.git.createTree({ ...context.repo, base_tree: source.tree.sha, tree });
  const { data: snapshot } = await github.rest.git.createCommit({
    ...context.repo, message: `Release ${selected}\n\n${marker}`, tree: updatedTree.sha, parents: [context.sha],
  });
  const branch = `releases/${selected}`;
  // createRef fails on collisions; an existing snapshot is never overwritten.
  await github.rest.git.createRef({ ...context.repo, ref: `refs/heads/${branch}`, sha: snapshot.sha });
  return { version: selected, branch, commit: snapshot.sha };
};
module.exports.nextVersion = nextVersion;
