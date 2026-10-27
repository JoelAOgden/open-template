import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Projects } from "./projects.js";
import { Studio } from "./studio.js";
import { createHttpServer } from "./http.js";
import { DesktopBridge } from "./desktop.js";

const root = process.env.OPEN_TEMPLATE_RESOURCE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = process.env.OPEN_TEMPLATE_DESKTOP === "1";
const dataRoot = desktop ? process.env.OPEN_TEMPLATE_DATA_DIR : undefined;
if (desktop && (!dataRoot || !path.isAbsolute(dataRoot))) throw new Error("Desktop data directory is missing.");
if (dataRoot) await fs.mkdir(dataRoot,{recursive:true});
let closing = false;
let app: ReturnType<typeof createHttpServer> | undefined;
async function close() {
  if (closing) return; closing = true;
  await app?.close(); process.exit(0);
}
const bridge = desktop ? new DesktopBridge(process.stdin,process.stdout,close) : undefined;
bridge?.listen();
const projects = new Projects(root, dataRoot ? path.join(dataRoot,"preferences") : undefined,
  bridge ? () => bridge.pickFolder() : undefined);
await projects.init();
const store = await projects.initialStore();
const studio = store ? new Studio(store) : null;
if (studio) { await studio.init(); await projects.opened(studio.store); }
const port = desktop ? 0 : Number(process.env.PORT || 4310);
if (!desktop && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error("PORT must be between 1024 and 65535.");
app = createHttpServer(studio, root, {dev:process.argv.includes("--dev"), projects,
  ...(bridge ? {desktopClose:()=>bridge.close()} : {})});
const actualPort = await app.listen(port);
if (bridge) bridge.send({type:"ready",port:actualPort});
else console.log(`open-template → http://127.0.0.1:${actualPort}\nProject folder: ${studio?.store.codeDir ?? "No project selected"}`);
process.on("SIGINT",()=>void close()); process.on("SIGTERM",()=>void close());
