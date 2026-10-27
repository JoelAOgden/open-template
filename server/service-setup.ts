import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ProviderSchema, providerLabel, type Provider } from "../shared/agent-settings.js";
import type { ServiceSetupAction, ServiceStatus } from "../shared/service-setup.js";
import { cliEnvironment, resolveCli, studioRoot, cliInvocation } from "./cli-path.js";
import { AppError } from "./files.js";

const exec = promisify(execFile);
export const shellQuote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
export function terminalScript(args: string[], platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "& " + args.map(arg => "'" + arg.replaceAll("'", "''") + "'").join(" ") + "\r\n";
  return "#!/bin/sh\nexec " + args.map(shellQuote).join(" ") + "\n";
}
export async function openSetupTerminal(script: string) {
  if (process.platform === "darwin") {
    await exec("/usr/bin/open", ["-a", "Terminal", script], { timeout: 10000 });
  } else if (process.platform === "linux") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("x-terminal-emulator", ["-e", "/bin/sh", script], {shell:false, detached:true, stdio:"ignore"});
      child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
    });
  } else if (process.platform === "win32") {
    await new Promise<void>((resolve,reject)=>{
      const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NoExit","-ExecutionPolicy","Bypass","-File",script],{shell:false,detached:true,stdio:"ignore",windowsHide:false});
      child.once("error",reject);child.once("spawn",()=>{child.unref();resolve();});
    });
  } else throw new AppError("Automatic setup needs macOS or a Linux desktop terminal. Sign in through the service on this machine, then refresh status.");
}
export class ServiceSetup {
  constructor(private root = studioRoot, private openTerminal = openSetupTerminal,
    private resolve = resolveCli, private execute = exec) {}
  async status(provider: Provider): Promise<ServiceStatus> {
    ProviderSchema.parse(provider);
    const binary = await this.resolve(provider, this.root);
    if (!binary) return {provider, installed:false, auth:"unknown", message:`${providerLabel(provider)} setup is incomplete. Restart open-template to finish automatic setup.`};
    const options = { cwd: os.tmpdir(), env: cliEnvironment(provider, this.root), timeout: 10000, maxBuffer: 65536 };
    const execute = (args:string[]) => { const command=cliInvocation(binary,args);return this.execute(command.binary,command.args,options); };
    let version: string;
    try { version = (await execute(["--version"])).stdout.trim().slice(0, 150); }
    catch { return {provider,installed:true,auth:"unknown",message:"The CLI was found but could not start. Check its installation in your terminal."}; }
    if (provider === "gemini") return {provider,installed:true,version,auth:"unknown",message:"Gemini manages sign-in in its terminal. Choose Login with Google, then use /quit to return. open-template cannot independently verify its login."};
    try {
      const result = await execute(provider === "codex" ? ["login", "status"] : ["auth", "status"]);
      if (provider === "claude" && JSON.parse(result.stdout).loggedIn !== true)
        return {provider,installed:true,version,auth:"signed-out",message:"Not signed in."};
      return {provider,installed:true,version,auth:"signed-in",message:"Signed in. The CLI will use your existing account."};
    } catch (error) {
      const code = (error as {code?: number|string}).code;
      return {provider,installed:true,version,auth:code === 1 ? "signed-out" : "unknown",
        message:code === 1 ? "Not signed in. Connect your account to continue." : "Could not check sign-in. Open the CLI login flow to connect your account."};
    }
  }
  async launch(provider: Provider, action: ServiceSetupAction) {
    ProviderSchema.parse(provider);
    if (action !== "login") throw new AppError("Unknown setup action.");
    const binary = await this.resolve(provider, this.root);
    if (!binary) throw new AppError("Service setup is incomplete. Restart open-template to finish automatic setup.");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-service-setup-"));
    await fs.chmod(directory, 0o700);
    const script = path.join(directory, `${provider}-setup.${process.platform === "win32" ? "ps1" : "command"}`);
    // Only validated provider/action values and app-owned paths are passed. No
    // browser-supplied shell commands, credential files or OAuth URLs are used.
    await fs.writeFile(path.join(directory, "environment.json"), JSON.stringify(cliEnvironment(provider, this.root)), {mode:0o600});
    const source = import.meta.url.endsWith(".ts");
    const args = [process.execPath, ...(source ? ["--import",fileURLToPath(import.meta.resolve("tsx"))] : []),
      fileURLToPath(new URL(`service-setup-runner.${source ? "ts" : "js"}`,import.meta.url)), provider, action, directory, binary];
    await fs.writeFile(script, terminalScript(args), {mode:0o700});
    try { await this.openTerminal(script); }
    catch { await fs.rm(directory, {recursive:true,force:true}); throw new AppError("Could not open a local terminal. Check that a desktop terminal is available, then try Sign in again."); }
    return {message: "Terminal opened. Complete sign-in there, then refresh status."};
  }
}
