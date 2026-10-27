import { launcher, hostPlatform } from "./launcher.js";
import type { RuntimePlatform } from "../shared/runtime-platform.js";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { AppError, allowedEntry, checkedPath, hash, readSafe } from "./files.js";
import { appendLog, cleanEnv, stripAnsi, terminateTree } from "./processes.js";
import type { RunnerState, StartInfo } from "../shared/model.js";

export function localUrl(line: string) {
  for (const match of stripAnsi(line).matchAll(/https?:\/\/[^\s<>"']+/g)) {
    try {
      const u = new URL(match[0]);
      if (
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        !u.username &&
        !u.password
      )
        return u.href;
    } catch {
      /* not a URL */
    }
  }
  return undefined;
}
// Validate paths without loading build artifacts into a source snapshot.
async function validateLaunchTree(root: string, relative = "") {
  const directory = relative ? await checkedPath(root,relative,true) : root;
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if (!allowedEntry(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    await checkedPath(root,child,true);
    if (entry.isDirectory()) await validateLaunchTree(root,child);
  }
}
export class Runner {
  state: RunnerState = {status:"stopped",command:launcher().command,cwd:"project_src",logLines:[]};
  private child: ChildProcess | null = null;
  private preparation: Promise<void> | null = null;
  private controller = new AbortController();
  constructor(private codeDir: string, private onFailure?: () => void, private label: "project_src" | "project" = "project_src", private platform: RuntimePlatform = hostPlatform()) { this.state.cwd = label; this.state.command = launcher(platform).command; }
  async info(): Promise<StartInfo> {
    try {
      const data = await readSafe(this.codeDir,launcher(this.platform).filename,true);
      const script = data.toString();
      if (!script.trim()) throw new Error(`${launcher(this.platform).filename} is empty. Implement the project launcher first.`);
      return {script,scriptHash:hash(data),filename:launcher(this.platform).filename};
    } catch(e) {
      return {script:null,scriptHash:null,error:(e as NodeJS.ErrnoException).code === "ENOENT" ? `No ${launcher(this.platform).filename}. Apply changes to generate the launcher for this platform.` : (e as Error).message};
    }
  }
  async start(reviewedHash:string) {
    if(this.child || this.preparation)throw new AppError("The project is already running or stopping.",409);
    this.controller = new AbortController();
    this.state={status:"starting",command:launcher(this.platform).command,cwd:this.label,logLines:[],startedAt:new Date().toISOString()};
    this.preparation=this.startPrepared(reviewedHash);
    try { await this.preparation; }
    catch(error) {
      this.state.status=this.controller.signal.aborted?"stopped":"error";
      appendLog(this.state.logLines,(error as Error).message);
      if(this.state.status==="error")this.onFailure?.();
      throw error;
    } finally {this.preparation=null;}
  }
  private async startPrepared(reviewedHash:string) {
    const launch = launcher(this.platform);
    await validateLaunchTree(this.codeDir);
    const info=await this.info();
    if(!info.script)throw new AppError(info.error!);
    if(info.scriptHash!==reviewedHash)throw new AppError(`${launch.filename} changed. Review it again before starting.`,409);
    this.controller.signal.throwIfAborted();
    appendLog(this.state.logLines,`$ ${launch.command}`);
    appendLog(this.state.logLines,"Running local code with your user permissions. Process status does not verify correctness.");
    const env=cleanEnv();
    const child=spawn(launch.binary,launch.args,{cwd:this.codeDir,env,shell:false,detached:process.platform !== "win32",windowsHide:true,stdio:["ignore","pipe","pipe"]});
    this.child=child;
    this.state.pid=child.pid;
    const runState=this.state;
    let tail="";
    const log=(data:Buffer)=>{
      const line=data.toString();appendLog(runState.logLines,line);tail=(tail+line).slice(-8000);
      runState.detectedLocalUrl=localUrl(tail)??runState.detectedLocalUrl;
    };
    child.stdout!.on("data",log);child.stderr!.on("data",log);
    child.once("error",error=>{
      appendLog(this.state.logLines,error.message);
      if(this.child!==child)return;
      this.state.status=this.controller.signal.aborted?"stopped":"error";
      this.child=null;delete this.state.pid;
    });
    child.once("exit",(code,signal)=>{
      // Launchers must keep their program in the foreground. Clean up descendants
      // on both a natural exit and Stop so no old project continues after a switch.
      terminateTree(child,"SIGKILL");
      if(this.child!==child)return;
      this.state.status=this.controller.signal.aborted || this.state.status==="stopping" ? "stopped" : code===0?"exited":"error";
      this.state.exitCode=code;this.state.exitSignal=signal;this.state.finishedAt=new Date().toISOString();
      appendLog(this.state.logLines,`Process exited (${code??signal}).`);
      this.child=null;delete this.state.pid;delete this.state.detectedLocalUrl;
      if(this.state.status==="error")this.onFailure?.();
    });
    await new Promise<void>((resolve,reject)=>{child.once("spawn",()=>{this.state.status="running";resolve();});child.once("error",reject);});
  }
  async stop() {
    this.controller.abort(new Error("Start cancelled."));
    if(this.preparation)await this.preparation.catch(()=>{});
    const child=this.child;if(!child)return;
    this.state.status="stopping";
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{terminateTree(child,"SIGKILL");resolve();},1800);
      child.once("exit",()=>{clearTimeout(timer);resolve();});
      terminateTree(child);
    });
    terminateTree(child,"SIGKILL");
  }
}
