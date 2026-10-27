import { randomUUID } from "node:crypto";
import type { PlanSession, Run, StudioState } from "../shared/model.js";
import { AgentSettingsSchema } from "../shared/agent-settings.js";
import { cachedModels } from "./agent-settings.js";
import { AppError } from "./files.js";
import { Store } from "./store.js";
import { Runner } from "./runner.js";
import { appendLog } from "./processes.js";
import { Workflows } from "./workflow.js";
import type { CodingAgent } from "./codex-cli.js";
import { PipelineHistory } from "./pipeline-history.js";

// Editor, preview and fixed workflow orchestration.
export class Studio {
  session: PlanSession | null = null;
  run: Run | null = null;
  private previewBusy = false;
  get busy() { return this.previewBusy || this.workflows.busy; }
  workspaceKey = randomUUID();
  readonly agent?: CodingAgent;
  workflows: Workflows;
  runner: Runner;
  pipelines: PipelineHistory;
  private previewController: AbortController | null = null;
  private previewJob: Promise<void> | null = null;
  constructor(public store: Store, agent?: CodingAgent) {
    this.agent = agent;
    this.workflows = new Workflows(store, agent);
    this.runner = new Runner(store.codeDir, undefined, store.layout === "folder" ? "project" : "project_src");
    this.pipelines = new PipelineHistory(store);
  }
  async init() {
    await this.store.init();
    if (this.store.state.sessionId)
      this.session = await this.store.load<PlanSession>(`plan-sessions/${this.store.state.sessionId}.json`);
    if (this.store.state.runId)
      this.run = await this.store.run(this.store.state.runId);
    await this.workflows.init();
  }
  async state(): Promise<StudioState> {
    return {
      settings: this.store.settings, project: this.store.project,
      workspace: {path:this.store.root,key:this.workspaceKey,layout:this.store.layout},
      workflow: this.workflows.active ? this.workflows.view(this.workflows.active) : null,
      session: this.session, run: this.run,
      appliedSnapshotHash: this.store.state.appliedSnapshotHash,
      checkpoint: this.store.state.checkpoint, draftRunId: this.store.state.draftRunId,
      implementationPending: this.store.state.implementationPending,
      busy: this.busy, runner: this.runner.state, startInfo: await this.runner.info(),
    };
  }
  async switchProject(store: Store) {
    if (this.busy) throw new AppError("Stop the current pipeline or launch before opening another project.", 409);
    const next = new Studio(store, this.agent);
    await next.init();
    await this.stopProject();
    const mutationQueue = this.workflows.mutateDefinitions;
    this.store = next.store; this.workflows = next.workflows; this.runner = next.runner; this.pipelines = next.pipelines;
    this.session = next.session; this.run = next.run; this.workspaceKey = randomUUID();
    this.workflows.mutateDefinitions = mutationQueue;
    this.previewController = null; this.previewJob = null;
  }
  async updateSettings(input: unknown) {
    const settings = AgentSettingsSchema.parse(input);
    if (settings.provider && settings.provider !== "codex" && settings.reasoning)
      throw new AppError("Reasoning overrides are supported only for Codex CLI. Use the selected CLI default.");
    const model = (settings.provider && settings.provider !== "codex" ? [] : await cachedModels()).find(m => m.id === settings.model);
    if (model && settings.reasoning && !model.reasoning.includes(settings.reasoning))
      throw new AppError("This model does not support that reasoning level.");
    return this.store.saveSettings(settings);
  }
  async startProject(scriptHash: string) {
    if (this.busy || ["starting", "running", "stopping"].includes(this.runner.state.status))
      throw new AppError("The project is already running or stopping.", 409);
    const info = await this.runner.info();
    if (!info.script || info.scriptHash !== scriptHash)
      throw new AppError(info.error ?? "The start script changed. Review it again before starting.", 409);
    const controller = this.previewController = new AbortController();
    this.previewBusy = true;
    this.previewJob = (async () => {
      try {
        await this.runner.start(scriptHash);
      } catch (error) {
        if (!controller.signal.aborted && this.runner.state.status !== "error") {
          await this.runner.stop();
          this.runner.state.status = "error";
          appendLog(this.runner.state.logLines, (error as Error).message);
        }
      } finally { this.previewBusy = false; }
    })();
  }
  async stopProject() {
    this.previewController?.abort(new Error("Preview stopped."));
    await this.runner.stop();
    await this.previewJob;
  }
  async close() { await this.workflows.stop(); await this.stopProject(); }
}
