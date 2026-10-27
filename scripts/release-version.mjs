import fs from 'node:fs/promises';

const [operation, value] = process.argv.slice(2);
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!['set', 'check'].includes(operation) || !value) throw new Error('Usage: release-version.mjs set <version> | check <vVersion>');
const version = operation === 'check' ? value.replace(/^v/, '') : value;
if (!semver.test(version) || (operation === 'check' && value !== `v${version}`)) throw new Error('Use a version such as 0.1.0 or 0.1.0-beta.1; release tags must start with v.');
const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
const contents = await Promise.all(files.map(file => fs.readFile(file, 'utf8')));
const updates = contents.map((content, index) => {
  let current;
  let next;
  if (index < 3) {
    const data = JSON.parse(content);
    current = data.version;
    if (operation === 'check' && index === 1 && data.packages[''].version !== version) throw new Error('package-lock.json root package version does not match the tag.');
    data.version = version;
    if (index === 1) data.packages[''].version = version;
    next = JSON.stringify(data, null, 2) + '\n';
  } else {
    const pattern = index === 3 ? /(\[package\][\s\S]*?\r?\nversion = ")([^"]+)(")/ : /(\[\[package\]\]\r?\nname = "open-template"\r?\nversion = ")([^"]+)(")/;
    current = content.match(pattern)?.[2];
    if (!current) throw new Error(`Cannot find app version in ${files[index]}`);
    next = content.replace(pattern, (_match, prefix, _old, suffix) => `${prefix}${version}${suffix}`);
  }
  if (operation === 'check' && current !== version) throw new Error(`${files[index]} has version ${current}; tag requires ${version}. Run npm run release:version -- ${version} and commit before tagging.`);
  return next;
});
if (operation === 'set') for (let i = 0; i < files.length; i++) await fs.writeFile(files[i], updates[i]);
console.log(`${operation === 'set' ? 'Updated' : 'Verified'} all app versions: ${version}`);
