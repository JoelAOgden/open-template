import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { Provider } from "../shared/agent-settings.js";
import { cleanEnv } from "./processes.js";

export const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const cliPrefix = (provider: Provider, root = studioRoot) => path.join(process.env.OPEN_TEMPLATE_TOOLS_DIR ?? path.join(root, ".studio-local", "cli"), provider);
export function cliInvocation(binary: string, args: string[]) {
  return /\.(?:mjs|cjs|js)$/i.test(binary) ? {binary:process.execPath,args:[binary,...args]} : {binary,args};
}
const packages = {codex:"@openai/codex",gemini:"@google/gemini-cli",claude:"@anthropic-ai/claude-code"};
export function cliEnvironment(provider: Provider, root = studioRoot): NodeJS.ProcessEnv {
  return { ...cleanEnv(), ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
    PATH: [...new Set([path.join(cliPrefix(provider, root), "node_modules", ".bin"), path.dirname(process.execPath),
      ...(process.env.PATH ?? "").split(path.delimiter).filter(p => path.isAbsolute(p)),
      path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].join(path.delimiter) };
}
export async function resolveCli(provider: Provider, root = studioRoot): Promise<string | undefined> {
  if (process.platform === "win32" || process.env.OPEN_TEMPLATE_TOOLS_DIR) {
    // Invoke the package entry point with bundled Node. Windows .cmd shims
    // cannot be spawned with shell:false and must never become shell strings.
    const packageRoot = path.join(cliPrefix(provider, root), "node_modules", packages[provider]);
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(packageRoot,"package.json"),"utf8"));
      const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[provider];
      if (typeof entry === "string") {
        const file = path.resolve(packageRoot,entry);
        if (!file.startsWith(packageRoot + path.sep)) throw new Error("Unsafe CLI entry point");
        if ((await fs.stat(file)).isFile()) return file;
      }
    } catch { /* A native installation may still be available. */ }
  }
  for (const directory of cliEnvironment(provider, root).PATH!.split(path.delimiter)) {
    const candidate = path.join(directory, provider + (process.platform === "win32" ? ".exe" : ""));
    try { await fs.access(candidate, fs.constants.X_OK); if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Try the next installation. */ }
  }
}
