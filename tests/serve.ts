import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Projects } from "../server/projects.js";
import { Store } from "../server/store.js";
import { Studio } from "../server/studio.js";
import { createHttpServer } from "../server/http.js";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-browser-"));
const projects = new Projects(root); await projects.init();
const studio = new Studio(new Store(path.join(root,"projects","fixture"),"folder"), {
  async status() { return { available: true }; },
  async run(call) {
    call.onSession(call.sessionId ?? (await import("node:crypto")).randomUUID());
    call.onEvent(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"I’m arranging the navigation."}}));
    await new Promise(resolve => setTimeout(resolve, 100));
    call.signal.throwIfAborted();
    if (call.writable) await fs.writeFile(path.join(call.cwd, "index.txt"), "Browser fixture output");
    return { status: "completed", summary: "Fixture stage complete", requirements: [], findings: [], skippedChecks: call.prompt.startsWith("Implement the changes described") ? [{ check: "Browser visuals", command: "npm run test:e2e", reason: "sandbox-restriction", evidence: "Fixture browser launch permission denied before execution" }] : [] };
  }
});
await studio.init(); await projects.opened(studio.store);
const app = createHttpServer(studio, process.cwd(), { dev: process.argv.includes("--dev"), projects });
await app.listen(4319);
console.log("Browser test workspace at http://127.0.0.1:4319");
async function close() {
 await app.close(); await fs.rm(root, { recursive: true, force: true }); process.exit();
}
process.on("SIGINT", close); process.on("SIGTERM", close);
