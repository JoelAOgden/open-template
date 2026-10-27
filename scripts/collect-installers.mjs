import fs from 'node:fs/promises';
import path from 'node:path';

const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const expected = process.platform === 'darwin' ? ['.dmg'] : process.platform === 'win32' ? ['.exe', '.msi'] : [];
if (!expected.length) throw new Error('Installer collection supports macOS and Windows only.');
const found = new Map();
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith('.app')) await visit(file);
    } else if (entry.isFile() && expected.includes(path.extname(entry.name))) {
      const extension = path.extname(entry.name);
      if (found.has(extension)) throw new Error(`Multiple ${extension} installers found; clean the build output first.`);
      found.set(extension, file);
    }
  }
}
await visit('src-tauri/target/release/bundle');
for (const extension of expected) if (!found.has(extension)) throw new Error(`Missing ${extension} installer.`);
await fs.mkdir('release-assets', { recursive: true });
for (const [extension, file] of found) {
  const name = `open-template-${version}-${process.platform === 'darwin' ? 'macos' : 'windows'}-${process.arch}${extension}`;
  await fs.copyFile(file, path.join('release-assets', name));
  console.log(name);
}
