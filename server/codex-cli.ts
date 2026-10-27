import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { startBrowserBridge } from "./browser.js";
import { providerLabel, type Provider, type AgentSettings } from "../shared/agent-settings.js";
import { StageOutputSchema, type StageOutput } from "../shared/workflow.js";
import { terminateTree } from "./processes.js";
import { cliEnvironment, resolveCli, cliInvocation } from "./cli-path.js";
import { AppError, readSafe } from "./files.js";

export type CodexCall = { cwd: string; prompt: string; writable: boolean; sessionId?: string; settings: AgentSettings;
  schemaFile?: string; resultFile: string; signal: AbortSignal; onEvent: (line: string) => void; onSession: (id: string) => void };
export interface CodingAgent {
  status(settings?: AgentSettings): Promise<{ available: boolean; version?: string; error?: string }>;
  run(call: CodexCall): Promise<StageOutput>;
}
export function codexArguments(call: CodexCall): string[] {
  const args = ["--no-daemon", "-a", "never", "-c", `sandbox_mode=${JSON.stringify(call.writable ? "workspace-write" : "read-only")}`,
    "-c", "sandbox_workspace_write.exclude_slash_tmp=true", "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c", `sandbox_workspace_write.network_access=${call.writable}`, "-c", "web_search=\"disabled\"",
    "-c", "features.shell_snapshot=false", "-c", "project_doc_max_bytes=65536"];
  if (call.settings.model) args.push("-m", call.settings.model);
  if (call.settings.reasoning) args.push("-c", `model_reasoning_effort=${JSON.stringify(call.settings.reasoning)}`);
  args.push("exec");
  if (call.sessionId) { z.string().uuid().parse(call.sessionId); args.push("resume", call.sessionId); }
  args.push("--ignore-user-config", "--ignore-rules", "--json");
  if (call.schemaFile) args.push("--output-schema", call.schemaFile);
  args.push("-o", call.resultFile, "-");
  return args;
}
export function providerArguments(provider: Provider, call: CodexCall): string[] {
  if (provider === "codex") return codexArguments(call);
  if (call.schemaFile) throw new AppError("Structured legacy calls must be resumed through the current workflow.");
  const args = provider === "gemini"
    ? ["--output-format", "stream-json", "--sandbox", "--approval-mode", call.writable ? "auto_edit" : "plan"]
    : ["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", call.writable ? "acceptEdits" : "plan"];
  if (provider === "gemini" && call.writable) args.push("--allowed-tools", "run_shell_command");
  if (provider === "claude") args.push("--setting-sources", "", "--strict-mcp-config", "--settings", JSON.stringify({
    sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, excludedCommands: [] },
  }));
  if (call.settings.model) args.push("--model", call.settings.model);
  if (call.sessionId) { z.string().uuid().parse(call.sessionId); args.push("--resume", call.sessionId); }
  return args;
}

export class AgentCLIs implements CodingAgent {
  constructor(private agents: Record<Provider, CodingAgent> = {
    codex: new CodexCLI(), gemini: new CodexCLI("gemini", startBrowserBridge, "gemini"),
    claude: new CodexCLI("claude", startBrowserBridge, "claude"),
  }) {}
  status(settings?: AgentSettings) { return this.agents[settings?.provider ?? "codex"].status(); }
  run(call: CodexCall) { return this.agents[call.settings.provider ?? "codex"].run(call); }
}

export class CodexCLI implements CodingAgent {
  constructor(private binary = "codex", private browserBridge = startBrowserBridge, private provider: Provider = "codex") {}
  async status() {
    try {
      const exec = (binary:string,args:string[],options:{timeout:number;env:NodeJS.ProcessEnv}) => {
        const command = cliInvocation(binary,args); return promisify(execFile)(command.binary,command.args,options);
      };
      const binary = this.binary === this.provider ? await resolveCli(this.provider) ?? this.binary : this.binary;
      const probeOptions = { timeout: 5000, env: cliEnvironment(this.provider) };
      if (this.provider !== "codex") {
        const [version, help] = await Promise.all([exec(binary, ["--version"], probeOptions), exec(binary, ["--help"], probeOptions)]);
        for (const flag of ["--output-format", "--resume", ...(this.provider === "gemini" ? ["--sandbox", "--approval-mode", "--allowed-tools"] : ["--permission-mode", "--setting-sources", "--strict-mcp-config", "--settings"])])
          if (!help.stdout.includes(flag)) throw new Error(`Installed CLI lacks ${flag}. Update the CLI.`);
        return { available: true, version: version.stdout.trim() };
      }
      const [version, help, resume] = await Promise.all([
        exec(binary, ["--version"], probeOptions), exec(binary, ["exec", "--help"], probeOptions), exec(binary, ["exec", "resume", "--help"], probeOptions),
      ]);
      for (const flag of ["--ignore-user-config", "--ignore-rules", "--output-last-message", "--json"]) if (!help.stdout.includes(flag) || !resume.stdout.includes(flag)) throw new Error(`Installed Codex lacks ${flag}. Update the CLI.`);
      return { available: true, version: version.stdout.trim() };
    } catch (e) { return { available: false, error: `${providerLabel(this.provider)} unavailable: ${(e as Error).message}. Restart open-template to finish automatic service setup, then sign in from Settings.` }; }
  }
  async run(call: CodexCall) {
    const args = providerArguments(this.provider, call);
    const status = await this.status();
    if (!status.available) throw new AppError(status.error!, 503);
    call.signal.throwIfAborted();
    await fs.rm(call.resultFile, { force: true });
    const env = cliEnvironment(this.provider);
    if (process.env.CODEX_HOME) env.CODEX_HOME = process.env.CODEX_HOME;
    // Tools use scratch space inside the sole writable code directory.
    env.TMPDIR = path.join(call.cwd, ".studio-tmp");
    await fs.mkdir(env.TMPDIR, { recursive: true });
    let browser: Awaited<ReturnType<typeof startBrowserBridge>> | undefined;
    if (call.writable) {
      try {
        browser = await this.browserBridge(call.signal, text => call.onEvent(`Studio browser: ${text}`));
        Object.assign(env, browser.env, {
          STUDIO_BROWSER_CLIENT: fileURLToPath(new URL("browser-client.mjs", import.meta.url)),
          STUDIO_BROWSER_GUIDE: fileURLToPath(new URL("browser-guide.md", import.meta.url)),
        });
      } catch (error) { call.onEvent(`Studio browser unavailable: ${(error as Error).message}`); }
    }
    if (call.signal.aborted) { await browser?.close(); call.signal.throwIfAborted(); }
    const binary = this.binary === this.provider ? await resolveCli(this.provider) ?? this.binary : this.binary;
    const command = cliInvocation(binary,args);
    const child = spawn(command.binary, command.args, { cwd: call.cwd, env, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let turnFailed = false, finished = false, response = "";
    let tail = "", errorTail = "", eventError: Error | undefined;
    const consume = (line: string) => {
      call.onEvent(line);
      try {
        const event = JSON.parse(line);
        if (this.provider !== "codex") {
          if ((event.type === "init" || event.type === "system") && event.session_id)
            call.onSession(z.string().uuid().parse(event.session_id));
          if (this.provider === "gemini" && event.type === "message" && event.role === "assistant" && typeof event.content === "string")
            response = event.delta ? response + event.content : event.content;
          if (event.type === "result") {
            finished = true;
            turnFailed ||= event.is_error === true || (this.provider === "gemini" ? event.status !== "success" : event.subtype !== "success");
            if (typeof event.result === "string") response = event.result;
            if (turnFailed) errorTail = JSON.stringify(event).slice(-6000);
            if (Array.isArray(event.permission_denials) && event.permission_denials.length) {
              turnFailed = true; errorTail = "CLI permission denied. Review the saved events and CLI permissions before resuming.";
            }
          }
          if (response.length > 4_000_000) { eventError = new Error("Agent response is oversized."); stop(); }
        }
        if (event.type === "thread.started") call.onSession(z.string().uuid().parse(event.thread_id));
        if (event.type === "turn.failed") turnFailed = true;
        if (event.type === "turn.failed" || event.type === "error") errorTail = JSON.stringify(event).slice(-6000);
      } catch { /* human-readable diagnostics are still retained */ }
    };
    const stop = () => terminateTree(child, "SIGKILL");
    call.signal.addEventListener("abort", stop, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          tail += chunk.toString();
          if (tail.length > 4_000_000) { eventError = new Error("CLI emitted an oversized event."); stop(); return; }
          let end: number; while ((end = tail.indexOf("\n")) >= 0) { consume(tail.slice(0, end)); tail = tail.slice(end + 1); }
        });
        child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString(); errorTail = (errorTail + text).slice(-6000); call.onEvent(text); });
        child.once("error", reject);
        child.once("close", code => { if (tail) consume(tail); code === 0 && !eventError && !turnFailed ? resolve() : reject(eventError ?? new Error(`${providerLabel(this.provider)} exited ${code}: ${errorTail}`)); });
        child.stdin.on("error", () => {}); child.stdin.end(call.prompt);
        if (call.signal.aborted) stop();
      });
      call.signal.throwIfAborted();
      if (this.provider !== "codex") {
        if (!finished) throw new AppError("CLI ended without a final result event. Resume to retry.");
        await fs.writeFile(call.resultFile, response);
      }
      const text = (await readSafe(path.dirname(call.resultFile), path.basename(call.resultFile), false, 4_000_000)).toString();
      if (call.schemaFile) return StageOutputSchema.parse(JSON.parse(text));
      // This records CLI completion, not a claim of independently verified code.
      return { status: "completed" as const, summary: text.trim() || "Agent finished without a final message.", requirements: [], findings: [] };
    } finally { call.signal.removeEventListener("abort", stop); terminateTree(child, "SIGKILL"); await browser?.close(); }
  }
}
