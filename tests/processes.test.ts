import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cleanEnv, terminateTree } from "../server/processes.js";

test("preview process termination stops the parent and descendants", { timeout: 10_000 }, async t => {
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const worker = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000); console.log('ready');"],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    worker.stdout.once('data', () => console.log('ready'));
    setInterval(() => {}, 1000);
  `], { shell: false, detached: true, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  t.after(() => terminateTree(child, "SIGKILL"));
  await once(child.stdout!, "data");
  terminateTree(child, "SIGKILL");
  await closed;
  for (let i = 0; i < 100; i++) {
    try { process.kill(-child.pid!, 0); }
    catch (e) { assert.equal((e as NodeJS.ErrnoException).code, "ESRCH"); return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Preview process group is still running");
});
