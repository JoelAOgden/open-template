import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function serviceReady(root, provider, tool) {
  const prefix = path.join(root, ".studio-local", "cli", provider);
  try {
    const installed = JSON.parse(await fs.readFile(path.join(prefix, "node_modules", tool.package, "package.json"), "utf8"));
    if (installed.version !== tool.version) return false;
    const packageRoot = path.join(prefix, "node_modules", tool.package);
    const entry = typeof installed.bin === "string" ? installed.bin : installed.bin?.[provider];
    const executable = entry ? path.resolve(packageRoot, entry) : path.join(prefix, "node_modules", ".bin", provider);
    if (entry && !executable.startsWith(packageRoot + path.sep)) return false;
    await fs.access(executable, entry ? fs.constants.R_OK : fs.constants.X_OK);
    return (await fs.stat(executable)).isFile();
  } catch { return false; }
}
export function installArguments(root, provider, tool) {
  return ["install", "--prefix", path.join(root, ".studio-local", "cli", provider), "--no-audit", "--no-fund",
    "--registry=https://registry.npmjs.org", "--save-exact", `${tool.package}@${tool.version}`];
}
function runNpm(args, root) {
  // npm supplies its own script path during lifecycle hooks. Direct launches
  // fall back to npm on PATH. Neither path accepts a shell command.
  const npmScript = process.env.npm_execpath;
  const binary = npmScript && path.isAbsolute(npmScript) ? process.execPath : "npm";
  const argv = binary === process.execPath ? [npmScript, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, {cwd:root, shell:false, stdio:"inherit"});
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`Service download exited ${code ?? "after interruption"}.`)));
  });
}
export async function prepareServices({root=appRoot, install=runNpm, log=console.log}={}) {
  const tools = JSON.parse(await fs.readFile(path.join(appRoot, "cli-tools.json"), "utf8"));
  for (const [provider, tool] of Object.entries(tools)) {
    if (await serviceReady(root, provider, tool)) continue;
    log(`Preparing ${tool.label} for open-template…`);
    await fs.mkdir(path.join(root, ".studio-local", "cli", provider), {recursive:true});
    await install(installArguments(root, provider, tool), root);
    if (!await serviceReady(root, provider, tool)) throw new Error(`${tool.label} setup did not produce the required executable.`);
  }
  log("open-template services are ready.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await prepareServices(); }
  catch (error) {
    console.error(`open-template setup could not finish: ${error.message}\nCheck your internet connection and restart open-template to retry. No separate CLI installation is needed.`);
    process.exitCode=1;
  }
}
