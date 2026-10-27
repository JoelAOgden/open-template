// Run in the agent's sandbox. Screenshot files are written here, never by Studio.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function browser(action, screenshotPath) {
  if (!process.env.STUDIO_BROWSER_URL) throw new Error('Studio browser is unavailable; see the run logs.');
  const response = await fetch(process.env.STUDIO_BROWSER_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.STUDIO_BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Browser operation failed');
  if (screenshotPath && result.image) {
    await fs.writeFile(screenshotPath, Buffer.from(result.image, 'base64'));
    return { screenshot: screenshotPath };
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await browser(JSON.parse(process.argv[2]), process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
