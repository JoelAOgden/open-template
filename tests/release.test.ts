import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const versionScript = path.resolve('scripts/release-version.mjs');
const installerScript = path.resolve('scripts/collect-installers.mjs');
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-template-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src-tauri'));
  for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) await fs.copyFile(file, path.join(root, file));
  return root;
}
test('release version command synchronizes manifests and rejects mismatching tags without writes', async t => {
  const root = await fixture(t);
  await exec(process.execPath, [versionScript, 'set', '1.2.3-beta.1'], { cwd: root });
  await exec(process.execPath, [versionScript, 'check', 'v1.2.3-beta.1'], { cwd: root });
  const before = await fs.readFile(path.join(root, 'package.json'), 'utf8');
  await assert.rejects(exec(process.execPath, [versionScript, 'check', 'v1.2.4'], { cwd: root }), /tag requires/);
  await assert.rejects(exec(process.execPath, [versionScript, 'set', 'not-a-version'], { cwd: root }), /Use a version/);
  assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), before);
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].version, '1.2.3-beta.1');
  assert.equal(lock.packages['node_modules/react'].version, JSON.parse(await fs.readFile('package-lock.json', 'utf8')).packages['node_modules/react'].version);
});
for (const eol of ['\n', '\r\n']) test(`release version supports ${eol === '\n' ? 'LF' : 'CRLF'} Cargo files without changing other bytes`, async t => {
  const root = await fixture(t);
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  const cargoFiles = ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  const originals = await Promise.all(cargoFiles.map(async file => {
    const content = (await fs.readFile(path.join(root, file), 'utf8')).replace(/\r?\n/g, eol);
    await fs.writeFile(path.join(root, file), content);
    return content;
  }));
  await exec(process.execPath, [versionScript, 'check', `v${version}`], { cwd: root });
  await exec(process.execPath, [versionScript, 'set', '9.8.7'], { cwd: root });
  await exec(process.execPath, [versionScript, 'check', 'v9.8.7'], { cwd: root });
  for (const [i, file] of cargoFiles.entries()) {
    const updated = await fs.readFile(path.join(root, file), 'utf8');
    assert.notEqual(updated, originals[i]);
    assert.equal(updated.replace('version = "9.8.7"', `version = "${version}"`), originals[i]);
  }
});
test('release collection requires installers and copies only platform downloads', { skip: !['darwin', 'win32'].includes(process.platform) }, async t => {
  const root = await fixture(t);
  const bundle = path.join(root, 'src-tauri/target/release/bundle');
  await fs.mkdir(bundle, { recursive: true });
  await assert.rejects(exec(process.execPath, [installerScript], { cwd: root }), /Missing/);
  const extensions = process.platform === 'darwin' ? ['.dmg'] : ['.exe', '.msi'];
  for (const extension of extensions) await fs.writeFile(path.join(bundle, `installer${extension}`), 'fixture installer');
  await fs.writeFile(path.join(bundle, 'debug.txt'), 'not a release asset');
  await exec(process.execPath, [installerScript], { cwd: root });
  const assets = await fs.readdir(path.join(root, 'release-assets'));
  assert.equal(assets.length, extensions.length);
  for (const asset of assets) {
    assert.ok(asset.includes(process.arch));
    assert.equal(await fs.readFile(path.join(root, 'release-assets', asset), 'utf8'), 'fixture installer');
  }
});
