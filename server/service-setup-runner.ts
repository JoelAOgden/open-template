// Runs only in a user-opened terminal. Login output never enters Studio logs.
import fs from "node:fs/promises";
import {openSync, closeSync, writeSync} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cliInvocation } from "./cli-path.js";
import { spawn } from "node:child_process";
import { z } from "zod";
import { ProviderSchema, type Provider } from "../shared/agent-settings.js";
export const loginArguments = (provider: Provider) => provider === "codex" ? ["login"] : provider === "claude" ? ["auth", "login"] : [];
export async function runSetup(provider: Provider, action: "login", directory: string, binary: string = provider) {
  ProviderSchema.parse(provider); z.literal("login").parse(action);
  const stored = z.record(z.string()).parse(JSON.parse(await fs.readFile(path.join(directory,"environment.json"),"utf8")));
  const env = {...stored, TERM:process.env.TERM || "xterm-256color"};
  delete (env as NodeJS.ProcessEnv).NO_COLOR;
  for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"])
    if (process.env[key]) (env as NodeJS.ProcessEnv)[key] = process.env[key];
  // A detached Windows sign-in terminal has its own console. Reopen its
  // console handles rather than inheriting the desktop backend's private pipes.
  const consoleHandles = process.platform === "win32" ? [openSync("CONIN$","r"),openSync("CONOUT$","w"),openSync("CONOUT$","w")] : undefined;
  const log = (message:string) => consoleHandles ? writeSync(consoleHandles[1],message+"\r\n") : console.log(message);
  const run = (binary: string, args: string[]) => new Promise<void>((resolve,reject) => {
    const child = spawn(binary,args,{cwd:directory,env,shell:false,stdio:consoleHandles ? [consoleHandles[0],consoleHandles[1],consoleHandles[2]] : "inherit"});
    child.once("error",reject);
    child.once("close",code=>code === 0 ? resolve() : reject(new Error(`${binary} exited ${code ?? "after interruption"}.`)));
  });
  log("Complete sign-in in this terminal and the browser opened by the CLI.");
  if (provider === "gemini") log("Choose Sign in with Google. If already at the prompt, use /auth to change account. After sign-in, enter /quit. Do not submit a coding task here.");
  const command=cliInvocation(binary,loginArguments(provider));
  try {
    await run(command.binary,command.args);
    log("CLI finished. Return to open-template and choose Refresh status.");
  } catch(error) { log(`Sign-in did not finish: ${(error as Error).message}`);throw error; }
  finally { consoleHandles?.forEach(fd=>closeSync(fd)); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [provider, action, directory, binary] = process.argv.slice(2);
  try { await runSetup(ProviderSchema.parse(provider),z.literal("login").parse(action),directory,binary); }
  catch(error) { console.error(`Setup did not finish: ${(error as Error).message}\nReturn to open-template to retry. No project files were changed.`); process.exitCode=1; }
  // Retain the terminal's visible output; remove only the private launch files.
  if (directory && path.basename(directory).startsWith("studio-service-setup-"))
    await fs.rm(directory,{recursive:true,force:true});
}
