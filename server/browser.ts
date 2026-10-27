import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";
import { cleanEnv, terminateTree } from "./processes.js";

const require = createRequire(import.meta.url);
export const BrowserAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().url() }).strict(),
  z.object({ action: z.literal("snapshot") }).strict(),
  z.object({ action: z.literal("screenshot"), fullPage: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("click"), selector: z.string().max(4000) }).strict(),
  z.object({ action: z.literal("fill"), selector: z.string().max(4000), value: z.string().max(100_000) }).strict(),
  z.object({ action: z.literal("press"), selector: z.string().max(4000), key: z.string().max(100) }).strict(),
  z.object({ action: z.literal("evaluate"), expression: z.string().max(100_000) }).strict(),
  z.object({ action: z.literal("viewport"), width: z.number().int().min(200).max(3840), height: z.number().int().min(200).max(2160) }).strict(),
]);
export function localPage(url: string) {
  try { const u = new URL(url); return ["http:", "https:"].includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && !u.username && !u.password; }
  catch { return false; }
}
async function launch(signal: AbortSignal, log: (text: string) => void) {
  signal.throwIfAborted();
  try { await fs.access(chromium.executablePath()); }
  catch {
    log("Installing Studio's Chromium browser (first use).");
    const child = spawn(process.execPath, [path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium", "--no-shell"],
      { env: cleanEnv(), shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stop = () => terminateTree(child, "SIGKILL");
    signal.addEventListener("abort", stop, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", chunk => log(chunk.toString())); child.stderr.on("data", chunk => log(chunk.toString()));
        child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(`Chromium installation exited ${code}.`)));
        if (signal.aborted) stop();
      });
    } finally { signal.removeEventListener("abort", stop); }
  }
  signal.throwIfAborted();
  log("Starting Studio Chromium for local website inspection.");
  return chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true, env: cleanEnv(), timeout: 30_000 });
}

// Studio owns the browser process; the agent only gets constrained page operations.
// No remote debugging endpoint, host filesystem access or arbitrary host commands.
export class BrowserSession {
  private browser?: Browser;
  private page?: Page;
  private starting?: Promise<Page>;
  private closed = false;
  constructor(private signal: AbortSignal, private log: (text: string) => void,
    private launchBrowser = launch) {}
  private async getPage() {
    if (this.closed) throw new Error("Browser session ended.");
    this.signal.throwIfAborted();
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.starting) this.starting = (async () => {
      const browser = await this.launchBrowser(this.signal, this.log);
      if (this.closed || this.signal.aborted) { await browser.close(); throw new Error("Browser session ended."); }
      this.browser = browser;
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
      await context.route("**/*", route => {
        const request = route.request(), url = request.url();
        // Local documents only; ordinary web assets may come from CDNs.
        if (!/^https?:/.test(url) || (request.isNavigationRequest() && !localPage(url))) return route.abort("blockedbyclient");
        return route.continue();
      });
      const page = await context.newPage();
      context.on("page", popup => { if (popup !== page) void popup.close().catch(() => {}); });
      page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(30_000);
      this.page = page;
      return page;
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async perform(input: unknown) {
    const action = BrowserAction.parse(input);
    if (action.action === "goto" && !localPage(action.url)) throw new Error("Only local HTTP(S) website URLs are allowed.");
    const page = await this.getPage();
    this.log(`Browser: ${action.action}`);
    switch (action.action) {
      case "goto": await page.goto(action.url, { waitUntil: "domcontentloaded" }); break;
      case "snapshot": return { url: page.url(), text: await page.locator("body").ariaSnapshot() };
      case "screenshot": return { image: (await page.screenshot({ fullPage: action.fullPage ?? false, timeout: 15_000 })).toString("base64") };
      case "click": await page.locator(action.selector).click(); break;
      case "fill": await page.locator(action.selector).fill(action.value); break;
      case "press": await page.locator(action.selector).press(action.key); break;
      case "viewport": await page.setViewportSize({ width: action.width, height: action.height }); break;
      case "evaluate": return { value: await page.evaluate(action.expression) };
    }
    return { url: page.url() };
  }
  async close() {
    this.closed = true;
    await this.browser?.close().catch(() => {});
    await this.starting?.catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
export async function startBrowserBridge(signal: AbortSignal, log: (text: string) => void) {
  const token = randomBytes(32).toString("hex"), session = new BrowserSession(signal, log);
  let host = "", queue: Promise<unknown> = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    if (req.headers.host !== host || req.headers.origin || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end(JSON.stringify({ error: "Forbidden" })); return;
    }
    if (req.method !== "POST" || req.url !== "/") { res.writeHead(404).end(); return; }
    try {
      let body = "";
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 128_000) throw new Error("Browser request too large."); }
      const input: unknown = JSON.parse(body);
      const result = queue.then(() => session.perform(input)); queue = result.catch(() => {});
      res.end(JSON.stringify(await result));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: (error as Error).message })); }
  });
  server.requestTimeout = 30_000;
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  } catch (error) { await session.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser bridge did not bind.");
  host = `127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    signal.removeEventListener("abort", abort);
    server.close(); server.closeAllConnections();
    await session.close();
  })();
  const abort = () => { void close(); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) await close();
  return { env: { STUDIO_BROWSER_URL: `http://${host}/`, STUDIO_BROWSER_TOKEN: token }, close };
}
