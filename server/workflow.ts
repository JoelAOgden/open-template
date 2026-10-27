import {pipelineNodes} from "../shared/pipeline-nodes.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Snapshot, DefinitionDiff } from "../shared/model.js";
import { AIDecisionSchema, type Workflow, type WorkflowView, type WorkflowInfo, type WorkflowStage, type StageKind, type SectionChange } from "../shared/workflow.js";
import { AppError, atomicWrite, checkedPath, changes, copyManifest, hash, manifestHash, readSafe, type Manifest } from "./files.js";
import { Store } from "./store.js";
import { workspaceReferences } from "./workspace-export.js";
import { definitionDiff } from "./definition-context.js";
import { AgentCLIs, type CodingAgent } from "./codex-cli.js";
import { appendLog } from "./processes.js";
import { readCheckpoint } from "./checkpoints.js";
import { recordValidationWarnings } from "./validation-policy.js";
import { saveAIDecisions, decisionContext } from "./ai-decisions.js";
import { launcher, hostPlatform } from "./launcher.js";

import {selectPipeline} from "./workflow/selection.js";

const sectionFocus = (slug?: string) => ["features", "design", "architecture", "testing"].includes(slug ?? "") ? slug! : "generic";
const stamp = () => new Date().toISOString();
const writeKinds = new Set<StageKind>(["implementing-changes", "building-first-project", "foundation", "section", "foundation-build", "section-build", "repair"]);
const encode = (files: Manifest) => Object.fromEntries(Object.entries(files).map(([p, b]) => [p, b.toString("base64")]));
function decode(files: Record<string, string>): Manifest { return Object.fromEntries(Object.entries(files).map(([p, b]) => [p, Buffer.from(b, "base64")])); }
export function sectionsForDiff(snapshot: Snapshot, before: Snapshot | null, diff: DefinitionDiff): SectionChange[] {
  const all = [...snapshot.project.sections, ...before?.project.sections.filter(s => !snapshot.project.sections.some(n => n.id === s.id)) ?? []];
  return all.filter(s => diff.changes.some(c => c.sectionId === s.id)).map(s => {
    const removed = !snapshot.project.sections.some(n => n.id === s.id);
    return { id: s.id, name: s.displayName, slug: s.slug, removed,
      diffs: diff.changes.flatMap((c, i) => c.sectionId === s.id ? [`changes/patch-${i}.diff`] : []),
      documents: (removed ? before! : snapshot).project.documents.filter(d => d.sectionId === s.id).map(d => `${removed ? "before/" : ""}spec/${s.slug}/${d.id}.md`),
      skill: `${removed ? "before/" : ""}.agents/skills/${s.slug}/SKILL.md` };
  });
}
function stage(id: string, title: string, kind: StageKind, sessionKey: string, sectionId?: string): WorkflowStage {
  return { id, title, kind, sessionKey, sectionId, status: "pending", attempts: [] };
}
function hasSectionContent(snapshot: Snapshot | null, id: string) {
  return !!snapshot?.project.documents.some(d => d.sectionId === id && d.nodes.some(n => {
    if (n.title?.trim()) return true;
    if (n.type === "image") return true;
    if (n.type === "list") return n.items.some(text => text.trim());
    if (n.type === "table") return n.rows.some(row => row.some(text => text.trim()));
    return !!n.text.trim();
  }));
}
export function fixedStages(sections: SectionChange[], includeFoundation = true): WorkflowStage[] {
  return [...(includeFoundation ? [stage("foundation", "Foundation", "foundation", "foundation")] : []),
    ...sections.map((s, i) => stage(`section-${i}`, s.name, "section", s.id, s.id))];
}
export class Workflows {
  active: Workflow | null = null;
  busy = false;
  mutateDefinitions: <T>(operation: () => Promise<T>) => Promise<T> = operation => operation();
  private controller?: AbortController;
  private job?: Promise<void>;
  private saving: Promise<void> = Promise.resolve();
  constructor(private store: Store, public agent: CodingAgent = new AgentCLIs()) {}
  private dir(id: string) { z.string().uuid().parse(id); return `workflows/${id}`; }
  private async root(w: Workflow) { return checkedPath(this.store.dataDir, `${this.dir(w.id)}/project`); }
  private async output(w: Workflow) { return checkedPath(this.store.dataDir, `${this.dir(w.id)}/project/output`); }
  private persist(w: Workflow) {
    w.updatedAt = stamp();
    const data = JSON.stringify(w);
    const save = this.saving.then(() => atomicWrite(this.store.dataDir, `${this.dir(w.id)}/workflow.json`, data));
    this.saving = save.catch(() => {});
    return save;
  }
  async init() {
    let id: string;
    try { id = (await this.store.load<{ id: string }>("workflow-active.json")).id; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    this.active = await this.get(id);
    if(this.active.cancellationRequested&&this.active.status!=="accepted"){await this.discardCancelled(this.active);return;}
    if (this.store.layout === "folder" && this.active.workspaceRoot !== this.store.root) {
      // CLI session paths are machine-specific; saved source/progress is portable.
      this.active.sessions = {}; this.active.workspaceRoot = this.store.root;
      await this.persist(this.active);
    }
    let transaction: { prior: Store["state"] } | undefined;
    try { transaction = await this.store.load(`${this.dir(id)}/accepting.json`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (transaction) {
      if (this.active.status !== "accepted") {
        await this.replace(this.store.codeDir, await this.store.projectManifest(this.store.codeDir), await this.base(this.active));
        this.store.state = transaction.prior; await this.store.saveState();
        this.active.status = "review"; this.active.error = this.active.acceptancePolicy==="automatic" ? "Interrupted application rolled back. Retry applying changes when ready." : "Interrupted acceptance rolled back; review and accept again.";
        await this.persist(this.active);
      }
      await fs.rm(await checkedPath(this.store.dataDir, `${this.dir(id)}/accepting.json`));
    }
    const restoration=await this.store.load<{prior:Store["state"]}>(`${this.dir(id)}/restoring.json`).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
    if(restoration){
      if(!this.active.rolledBack){
        const result=decode(await this.store.load<Record<string,string>>(`${this.dir(id)}/checkpoints/${this.active.sourceHash}.json`));
        if(manifestHash(result)!==this.active.sourceHash)throw new AppError("Rollback checkpoint is damaged.",409);
        await this.replace(this.store.codeDir,await this.store.projectManifest(this.store.codeDir),result);
        this.store.state=restoration.prior;await this.store.saveState();
      }
      await fs.rm(await checkedPath(this.store.dataDir,`${this.dir(id)}/restoring.json`));
    }
    this.active.applying=false;
    if (this.active.status === "running") {
      this.active.status = "paused";
      this.active.error = "Studio stopped during this run. Saved output is preserved; Resume continues the interrupted stage.";
      const interrupted = [...this.active.stages, ...this.active.recoveries ?? []].find(s => s.status === "running");
      if (interrupted && !writeKinds.has(interrupted.kind) && manifestHash(await this.store.projectManifest(await this.output(this.active))) !== this.active.sourceHash) {
        this.active.integrityFailure = true; this.active.error = "Interrupted read-only stage modified source.";
      }
      for (const s of [...this.active.stages, ...this.active.recoveries ?? []]) if (s.status === "running") { s.status = "stopped"; Object.assign(s.attempts.at(-1)!, { status: "stopped", finishedAt: stamp() }); }
      try { await this.assertReferences(this.active); await this.checkpoint(this.active); }
      catch (e) { this.active.integrityFailure = true; this.active.error = (e as Error).message; }
      await this.persist(this.active);
    }
  }
  async get(id: string) {
    if (this.active?.id === id) return this.active;
    return this.store.load<Workflow>(`${this.dir(id)}/workflow.json`);
  }
  view(w: Workflow): WorkflowView {
    const { snapshot, referenceHashes, ...view } = w;
    return { ...view, snapshotHash: snapshot.hash, references: Object.keys(referenceHashes) };
  }
  async list(): Promise<WorkflowInfo[]> {
    const dir = await checkedPath(this.store.dataDir, "workflows");
    const entries = await fs.readdir(dir).catch(e => { if (e.code === "ENOENT") return []; throw e; });
    const result: WorkflowInfo[] = [];
    for (const id of entries.filter(id => z.string().uuid().safeParse(id).success)) {
      let w: Workflow; try { w = await this.get(id); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
      result.push({ id, createdAt: w.createdAt, updatedAt: w.updatedAt, status: w.status, error: w.error, cancelled:w.cancelled,rolledBack:w.rolledBack,applying:w.applying,acceptancePolicy:w.acceptancePolicy,
        completed: w.stages.filter(s => ["completed", "skipped"].includes(s.status)).length, total: w.stages.length });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private idle() { if (this.busy) throw new AppError("A workflow is already running.", 409); }
  private current(id: string) {
    this.idle(); if (this.active?.id !== id) throw new AppError("Only the active workflow can be changed.", 409); return this.active;
  }
  async create(options: { fullSpec: boolean; source: "project" | "saved-draft"; acceptancePolicy?: "automatic" | "manual" }) {
    options={...options,acceptancePolicy:options.acceptancePolicy??"automatic"};
    this.idle();
    if (this.active && !["accepted", "dismissed"].includes(this.active.status)) throw new AppError("Resume, accept or dismiss the existing workflow first.", 409);
    const available = await this.agent.status(this.store.settings); if (!available.available) throw new AppError(available.error!, 503);
    const snapshot = await this.store.snapshot();
    const before = options.fullSpec ? null : await this.store.appliedSnapshot();
    const diff = definitionDiff(before, snapshot);
    if (!diff.changes.length) throw new AppError("No definition changes. Choose Review full specification to check existing code against all documents.", 409);
    const base = await this.store.projectManifest(this.store.codeDir);
    let initial = base;
    if (options.source === "saved-draft") {
      if (!this.store.state.checkpoint) throw new AppError("No saved earlier draft.", 409);
      const saved = await readCheckpoint(this.store, this.store.state.checkpoint);
      if (manifestHash(base) !== saved.info.baseHash) throw new AppError("The earlier draft's baseline no longer matches the project source.", 409);
      initial = saved.result;
    }
    const runtimePlatform = hostPlatform(), launch = launcher(runtimePlatform);
    if (!Object.hasOwn(initial, launch.filename)) initial = {...initial, [launch.filename]:Buffer.from(launch.stub)};
    const id = randomUUID(), sections = sectionsForDiff(snapshot, before, diff).filter(s => hasSectionContent(snapshot, s.id) || hasSectionContent(before, s.id));
    const singleSectionUpdate = !!this.store.state.appliedSnapshotHash && sections.length === 1
      && diff.changes.every(change => change.sectionId === sections[0].id);
    const selection = selectPipeline(before,snapshot,diff,sections,!!this.store.state.appliedSnapshotHash,options.fullSpec);
    const w: Workflow = { acceptancePolicy:options.acceptancePolicy??"manual", ...(options.acceptancePolicy==="automatic"?{pipelineMode:selection.mode,diffStats:selection.stats}:{}), runtimePlatform, workspaceRoot: this.store.root, version: 1, executionMode: "prompt", validationPolicyVersion: 1, runtimePolicyVersion: 1, id, createdAt: stamp(), updatedAt: stamp(), status: "ready", snapshot,
      baselineHash: this.store.state.appliedSnapshotHash, baseSourceHash: manifestHash(base), sourceHash: manifestHash(initial), source: options.source,
      settings: { ...this.store.settings }, decisionContext: await decisionContext(this.store, snapshot), sections, stages: options.acceptancePolicy==="automatic" ? selection.stages : fixedStages(sections, !singleSectionUpdate), sessions: {}, changedFiles: changes(base, initial), referenceHashes: {}, replies: [] };
    const root = await this.root(w); await fs.mkdir(root, { recursive: true });
    await copyManifest(initial, await this.output(w));
    // A real project root prevents inheritance of Studio's own AGENTS.md.
    // Initialize the empty repository structure without requiring a Git install.
    await fs.mkdir(path.join(root, ".git", "objects"), {recursive:true});
    await fs.mkdir(path.join(root, ".git", "refs", "heads"), {recursive:true});
    await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.writeFile(path.join(root, ".git", "config"), "[core]\nrepositoryformatversion = 0\nbare = false\n");
    const refs = workspaceReferences(snapshot, runtimePlatform);
    if (before) for (const [name, text] of workspaceReferences(before, runtimePlatform)) refs.set(`before/${name}`, text);
    refs.set("changes/index.json", JSON.stringify({ baseSnapshotHash: diff.baseSnapshotHash, snapshotHash: snapshot.hash,
      changes: diff.changes.map((c, i) => ({ ...c, diff: undefined, patch: `changes/patch-${i}.diff` })), sections }, null, 2));
    for (const [i, change] of diff.changes.entries()) refs.set(`changes/patch-${i}.diff`, change.diff);
    for (const s of sections) refs.set(`changes/section-${s.id}.json`, JSON.stringify(s, null, 2));
    for (const [file, text] of refs) { await atomicWrite(root, file, text); w.referenceHashes[file] = hash(text); }
    for (const asset of new Set([...snapshot.project.documents, ...before?.project.documents ?? []].flatMap(d => d.assetRefs))) {
      const data = await readSafe(this.store.dataDir, `assets/${asset}`, false, Infinity);
      if(/^[a-f0-9]{64}\./.test(asset)&&!asset.startsWith(hash(data)+"."))throw new AppError("Referenced asset changed outside the app.",409);
      for (const prefix of ["", ...(before ? ["before/"] : [])]) { const file = `${prefix}assets/${asset}`; await atomicWrite(root, file, data); w.referenceHashes[file] = hash(data); }
    }
    // Freeze prompt templates with the run, so retries are reproducible after app updates.
    await this.freezePrompts(w, root);
    await atomicWrite(this.store.dataDir, `${this.dir(id)}/base.json`, JSON.stringify(encode(base)));
    await atomicWrite(this.store.dataDir, `${this.dir(id)}/prior-state.json`,JSON.stringify(this.store.state));
    await this.checkpoint(w); await this.persist(w);
    await atomicWrite(this.store.dataDir, "workflow-active.json", JSON.stringify({ id })); this.active = w;
    this.launch(w);
    return this.view(w);
  }
  private async base(w: Workflow) {
    const base = decode(await this.store.load<Record<string, string>>(`${this.dir(w.id)}/base.json`));
    if (manifestHash(base) !== w.baseSourceHash) throw new AppError("Saved baseline integrity check failed.", 409);
    return base;
  }
  private async checkpoint(w: Workflow) {
    const result = await this.store.projectManifest(await this.output(w));
    w.sourceHash = manifestHash(result); w.changedFiles = changes(await this.base(w), result);
    await atomicWrite(this.store.dataDir, `${this.dir(w.id)}/checkpoints/${w.sourceHash}.json`, JSON.stringify(encode(result)));
    return result;
  }
  private async assertReferences(w: Workflow) {
    const root = await this.root(w);
    for (const [file, expected] of Object.entries(w.referenceHashes)) if (hash(await readSafe(root, file, false, Infinity)) !== expected) throw new AppError(`Frozen reference changed: ${file}. Work stopped.`, 409);
  }
  private launch(w: Workflow) {
    this.busy = true; this.controller = new AbortController();
    this.job = this.execute(w, this.controller.signal).finally(() => { this.busy = false; });
    this.job.catch(() => {});
  }
  private async recordDecisions(w: Workflow, decisions: NonNullable<import("../shared/workflow.js").StageOutput["decisions"]>, signal: AbortSignal) {
    signal.throwIfAborted();
    const accepted = w.acceptancePolicy === "automatic" ? decisions : await this.mutateDefinitions(async () => { signal.throwIfAborted(); return saveAIDecisions(this.store, decisions); });
    w.decisions ??= [];
    for (const decision of accepted) {
      const index = w.decisions.findIndex(d => d.key === decision.key);
      if (index < 0) w.decisions.push(decision); else w.decisions[index] = decision;
    }
    await this.persist(w);
    return accepted;
  }
  private async adoptPromptWorkflow(w: Workflow) {
    if (w.executionMode === "prompt") return;
    const previous = w.stages;
    w.archivedStages = [...w.archivedStages ?? [], ...structuredClone(previous)];
    // Include removed/emptied sections when they previously had content. Frozen
    // before documents remain available even if the live definition has changed.
    const root = await this.root(w);
    const sections: SectionChange[] = [];
    for (const section of w.sections) {
      const changedBefore = Object.keys(w.referenceHashes).filter(p => p.startsWith(`before/spec/${section.slug}/`));
      let hadContent = false;
      for (const file of changedBefore) {
        const text = (await readSafe(root, file, false, Infinity)).toString();
        if (text.split("\n").slice(1).join("\n").trim()) { hadContent = true; break; }
      }
      if (hasSectionContent(w.snapshot, section.id) || hadContent) sections.push(section);
    }
    w.stages = fixedStages(sections).map(next => {
      const old = previous.find(s => next.kind === "foundation" ? s.id === "foundation-build" : s.kind === "section-build" && s.sectionId === next.sectionId);
      return old?.status === "completed" ? { ...next, id: old.id, status: "completed", attempts: structuredClone(old.attempts) } : next;
    });
    // A retired review may already have found unfinished code. If all build
    // steps finished, use the foundation prompt once to address that saved work.
    const unfinished = previous.some(s => ["blocked", "failed"].includes(s.status) && s.attempts.at(-1)?.output?.findings.length);
    if (unfinished && w.stages.every(s => s.status === "completed")) w.stages[0].status = "pending";
    await this.freezePrompts(w, root);
    const guidance = workspaceReferences(w.snapshot, w.runtimePlatform ?? "macos").get("AGENTS.md")!;
    await atomicWrite(root, "prompts/project-guidance.md", guidance);
    w.referenceHashes["prompts/project-guidance.md"] = hash(guidance);
    // New context avoids carrying the old required reports into continued work.
    w.sessions = {}; w.executionMode = "prompt";
    await this.persist(w);
  }
  private async collectDecisions(w: Workflow, s: WorkflowStage, signal: AbortSignal) {
    let decisions;
    try {
      decisions = z.array(AIDecisionSchema).max(8).parse(JSON.parse((await readSafe(await this.output(w), ".studio/decisions.json")).toString()));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") appendLog(s.attempts.at(-1)!.logs, `AI decisions were not imported: ${(e as Error).message}`);
      return;
    }
    const accepted = await this.recordDecisions(w, decisions, signal);
    s.attempts.at(-1)!.output!.decisions = accepted;
  }
  async resume(id: string, message = "", fresh = false) {
    const w = this.current(id);
    if (!["paused", "blocked", "failed"].includes(w.status) || w.integrityFailure) throw new AppError("This workflow cannot be resumed.", 409);
    await this.assertReferences(w);
    if (manifestHash(await this.store.projectManifest(await this.output(w))) !== w.sourceHash) throw new AppError("Draft changed outside this run. Saved checkpoints are retained.", 409);
    if (manifestHash(await this.store.projectManifest(this.store.codeDir)) !== w.baseSourceHash) throw new AppError("Project source changed since this run began.", 409);
    const savedPlatform = w.runtimePlatform ?? "macos";
    if ((savedPlatform === "windows") !== (hostPlatform() === "windows"))
      throw new AppError("This draft targets another operating system. Resume it on that platform, or dismiss it and create a new run for this platform.", 409);
    await this.adoptPromptWorkflow(w);
    if (message.trim()) w.replies.push({ text: message.trim(), createdAt: stamp() });
    const failed = w.stages.find(s => !["completed", "skipped"].includes(s.status));
    if (failed && fresh) delete w.sessions[failed.sessionKey];
    this.launch(w);
  }
  async retryApply(id:string) {
    const w=this.current(id);
    if(w.acceptancePolicy!=="automatic"||!["review","failed"].includes(w.status)||w.integrityFailure||w.cancellationRequested||!w.stages.every(s=>["completed","skipped"].includes(s.status)))throw new AppError("This run is not ready to apply.",409);
    this.busy=true;w.applying=true;
    try {await this.mutateDefinitions(async()=>{w.status="review";await this.persist(w);await this.commit(w);});}
    catch(error){if((w as Workflow).status!=="accepted")w.status="failed";w.error=(error as Error).message;throw error;}
    finally {w.applying=false;this.busy=false;await this.persist(w);}
  }
  async rollback(id:string) {
    const w=this.current(id);
    if(w.status!=="accepted"||w.rolledBack)throw new AppError("Only the latest applied run can be restored.",409);
    await this.mutateDefinitions(async()=>{
      if(manifestHash(await this.store.projectManifest(this.store.codeDir))!==w.sourceHash||this.store.state.appliedSnapshotHash!==w.snapshot.hash)throw new AppError("Project changed after this run. Restore would overwrite newer work.",409);
      const previous=await this.store.load<Store["state"]>(`${this.dir(id)}/prior-state.json`);
      const prior={...this.store.state},result=await this.store.projectManifest(this.store.codeDir),base=await this.base(w);
      const journal=`${this.dir(id)}/restoring.json`;
      await atomicWrite(this.store.dataDir,journal,JSON.stringify({prior}));
      try {
        await this.replace(this.store.codeDir,result,base);
        this.store.state=previous;await this.store.saveState();w.rolledBack=true;w.status="dismissed";await this.persist(w);
      } catch(error){
        await this.replace(this.store.codeDir,await this.store.projectManifest(this.store.codeDir),result);
        this.store.state=prior;await this.store.saveState();w.rolledBack=false;w.status="accepted";await this.persist(w);throw error;
      }
      await fs.rm(await checkedPath(this.store.dataDir,journal));
    });
  }
  async cancel(id:string) {
    const w=this.active;
    if(!w||w.id!==id)throw new AppError("Only the active run can be cancelled.",409);
    if(w.applying||w.status==="accepted")throw new AppError("Changes are already applying or applied. Cancel is no longer available.",409);
    w.cancellationRequested=true;await this.persist(w);
    await this.stop();
    await this.discardCancelled(w);
  }
  private async discardCancelled(w:Workflow) {
    await fs.rm(await this.output(w),{recursive:true,force:true});
    await fs.rm(await checkedPath(this.store.dataDir,`${this.dir(w.id)}/checkpoints`),{recursive:true,force:true});
    w.decisions=[];w.cancelled=true;w.status="dismissed";w.error=undefined;w.sessions={};await this.persist(w);
  }
  async stop() { this.controller?.abort(new Error("Stopped by user.")); await this.job; }
  async waitForIdle() { await this.job; }
  async dismiss(id: string) { const w = this.current(id); if (["accepted", "dismissed"].includes(w.status)) throw new AppError("Workflow already closed.", 409); w.status = "dismissed"; await this.persist(w); }
  private async freezePrompts(w: Workflow, root: string) {
    const names = new Set(w.stages.flatMap(s => s.kind === "section"
      ? [s.promptTemplate??"section", s.focusTemplate??`section-${sectionFocus(w.sections.find(section => section.id === s.sectionId)?.slug)}`]
      : [s.promptTemplate??s.kind]));
    for (const name of names) {
      const file = `prompts/${name}.md`;
      const text = await fs.readFile(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      await atomicWrite(root, file, text); w.referenceHashes[file] = hash(text);
    }
  }
  private async prompt(w: Workflow, s: WorkflowStage) {
    const root = await this.root(w);
    let template = (await readSafe(root, `prompts/${s.promptTemplate??(s.nodeType?pipelineNodes[s.nodeType].prompt:s.kind)}.md`)).toString();
    const section = w.sections.find(section => section.id === s.sectionId);
    // Existing runs retain their original frozen template and need no focus file.
    if (s.kind === "section" && template.includes("{focus}")) {
      const focus = (await readSafe(root, `prompts/${s.focusTemplate??`section-${sectionFocus(section?.slug)}`}.md`)).toString().trim();
      template = template.replaceAll("{focus}", focus);
    }
    return template.replaceAll("{project}", JSON.stringify(await this.output(w)))
      .replaceAll("{diffs}", JSON.stringify(path.join(root, "changes/index.json")))
      .replaceAll("{section}", JSON.stringify(section?.name ?? ""))
      .replaceAll("{sectionDiff}", JSON.stringify(path.join(root, `changes/section-${section?.id}.json`)))
      + `\nRead ../${w.archivedStages?.length ? "prompts/project-guidance.md" : "AGENTS.md"} and ../results/context.json for project guidance and user notes. Work only inside the project directory.\n`
      + "For local website inspection, use Studio Chromium via the STUDIO_BROWSER_CLIENT environment variable. Read STUDIO_BROWSER_GUIDE for commands; this avoids launching Chromium inside the coding sandbox.\n"
      + (w.archivedStages?.length ? "This run now uses one implementation prompt per step; this supersedes frozen instructions requiring analysis reports, JSON responses, review gates or recovery agents. Continue from the existing code.\n" : "");
  }
  private async execute(w: Workflow, signal: AbortSignal) {
    w.status = "running"; delete w.error; await this.persist(w);
    const timer = setInterval(() => { void this.persist(w).catch(e => this.controller?.abort(e)); }, 750);
    try {
      for (let index = 0; index < w.stages.length; index++) {
        signal.throwIfAborted();
        const s = w.stages[index]; if (["completed", "skipped"].includes(s.status)) continue;
        if (s.kind === "start") { s.status = "skipped"; await this.persist(w); continue; }
        await this.assertReferences(w);
        const root = await this.root(w), output = await this.output(w);
        const before = await this.store.projectManifest(output), beforeHash = manifestHash(before);
        if (beforeHash !== w.sourceHash) throw new AppError("Draft source changed between stages.", 409);
        const attempt = { number: s.attempts.length + 1, status: "running" as const, startedAt: stamp(), prompt: await this.prompt(w, s), logs: [] as string[] };
        s.attempts.push(attempt); s.status = "running"; await this.persist(w);
        const a = s.attempts.at(-1)!;
        try {
            await atomicWrite(root, "results/context.json", JSON.stringify({
              replies: w.replies, decisions: w.decisions ?? [], existingDecisions: w.decisionContext ?? [],
              previousUnfinishedWork: (w.archivedStages ?? []).filter(s => ["failed", "blocked"].includes(s.status) && s.attempts.at(-1)?.output)
                .map(s => ({ step: s.title, response: `../results/${s.id}.json` })),
            }, null, 2));
            const controls = await checkedPath(this.store.dataDir, `${this.dir(w.id)}/calls/${s.id}-${a.number}`);
            await fs.mkdir(controls, { recursive: true });
            await atomicWrite(controls, "prompt.txt", a.prompt);
            a.resumedSessionId = w.sessions[s.sessionKey];
            let logging = Promise.resolve();
            let logError: unknown;
            const onEvent = (line: string) => {
              appendLog(a.logs, line);
              logging = logging.then(() => fs.appendFile(path.join(controls, "events.jsonl"), line + "\n")).catch(e => { logError = e; });
            };
            try {
              a.output = await this.agent.run({ cwd: output, prompt: a.prompt, writable: writeKinds.has(s.kind), sessionId: a.resumedSessionId,
                settings: w.settings, resultFile: path.join(controls, "response.txt"), signal, onEvent,
                onSession: id => { a.sessionId = id; w.sessions[s.sessionKey] = id; },
              });
            } finally { await logging; }
            if (logError) throw logError;
            await atomicWrite(root, `results/${s.id}.json`, JSON.stringify(a.output, null, 2));
          signal.throwIfAborted();
          await this.assertReferences(w);
          if (!writeKinds.has(s.kind) && manifestHash(await this.store.projectManifest(output)) !== beforeHash) { w.integrityFailure = true; throw new Error("A read-only stage modified source. The result cannot advance."); }
          if (a.output?.decisions?.length) {
            a.output.decisions = await this.recordDecisions(w, a.output.decisions, signal);
            await atomicWrite(root, `results/${s.id}.json`, JSON.stringify(a.output, null, 2));
          }
          await this.collectDecisions(w, s, signal);
          await atomicWrite(root, `results/${s.id}.json`, JSON.stringify(a.output, null, 2));
          await this.checkpoint(w); a.sourceHash = w.sourceHash; a.finishedAt = stamp();
          recordValidationWarnings(w, s, a.output);
          if (a.output?.status === "blocked" || a.output?.status === "failed") {
            s.status = a.status = a.output.status === "failed" ? "failed" : "blocked";
            w.status = s.status; w.error = a.output.summary; await this.persist(w); return;
          }
          s.status = a.status = "completed"; await this.persist(w);
        } catch (e) {
          a.error = (e as Error).message; a.finishedAt = stamp();
          a.status = s.status = signal.aborted ? "stopped" : "failed";
          try {
            await this.assertReferences(w);
            if (!writeKinds.has(s.kind) && manifestHash(await this.store.projectManifest(output)) !== beforeHash) { w.integrityFailure = true; a.error = "Read-only stage modified source."; }
            await this.checkpoint(w);
          } catch (integrity) { w.integrityFailure = true; a.error = (integrity as Error).message; }
          throw new Error(a.error);
        }
      }
      w.status = "review";
      signal.throwIfAborted();
      if(w.acceptancePolicy === "automatic") {
        await this.mutateDefinitions(async()=>{
          signal.throwIfAborted();
          if(w.cancellationRequested)throw new AppError("Run cancelled.",409);
          w.applying=true;await this.persist(w);
          try { await this.commit(w); } finally {w.applying=false;}
        });
      }
    } catch (e) { if((w as Workflow).status!=="accepted")w.status = signal.aborted ? "paused" : "failed"; w.error = (e as Error).message; }
    finally { clearInterval(timer); await this.persist(w); }
  }
  async file(id: string, file: string) {
    const w = await this.get(id), root = await this.root(w);
    if (!Object.hasOwn(w.referenceHashes, file) && !/^results\/(?:handoff|startup-check|[a-z0-9-]+)\.json$/.test(file)) throw new AppError("Reference file not found.", 404);
    return { path: file, text: (await readSafe(root, file, false, Infinity)).toString() };
  }
  async events(id: string, stageId: string, attempt: number, offset: number) {
    const w = await this.get(id), s = [...w.stages, ...w.archivedStages ?? [], ...w.recoveries ?? []].find(s => s.id === stageId);
    if (!s?.attempts.some(a => a.number === attempt)) throw new AppError("Attempt not found.", 404);
    const file = await checkedPath(this.store.dataDir, `${this.dir(id)}/calls/${stageId}-${attempt}/events.jsonl`);
    const handle = await fs.open(file, "r");
    try { const buffer = Buffer.alloc(64 * 1024); const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); return { text: buffer.subarray(0, bytesRead).toString(), nextOffset: offset + bytesRead }; }
    finally { await handle.close(); }
  }
  async accept(id: string) {
    const w = this.current(id);
    await this.commit(w);
  }
  private async commit(w:Workflow) {
    const id=w.id;
    if (w.status !== "review" || w.integrityFailure) throw new AppError("Finish the implementation steps before accepting this draft.", 409);
    await this.assertReferences(w);
    const result = await this.store.projectManifest(await this.output(w));
    if (manifestHash(result) !== w.sourceHash) throw new AppError("Draft changed since the last completed step.", 409);
    const base = await this.base(w);
    if (manifestHash(await this.store.projectManifest(this.store.codeDir)) !== w.baseSourceHash || this.store.state.appliedSnapshotHash !== w.baselineHash) throw new AppError("Project or applied baseline changed since this run. Nothing imported.", 409);
    const prior = { ...this.store.state };
    const journal = `${this.dir(id)}/accepting.json`;
    await atomicWrite(this.store.dataDir, journal, JSON.stringify({ prior }));
    try {
      await this.replace(this.store.codeDir, base, result);
      await this.store.saveAppliedSnapshot(w.snapshot);
      this.store.state = { ...prior, appliedSnapshotHash: w.snapshot.hash, implementationPending: false };
      await this.store.saveState();
      w.status = "accepted"; await this.persist(w);
    } catch (e) {
      this.store.state = prior; w.status = "review";
      await this.replace(this.store.codeDir, await this.store.projectManifest(this.store.codeDir), base);
      await this.store.saveState();
      await fs.rm(await checkedPath(this.store.dataDir, journal)); throw e;
    }
    await fs.rm(await checkedPath(this.store.dataDir, journal));
    if(w.acceptancePolicy==="automatic"&&w.decisions?.length){
      try {await saveAIDecisions(this.store,w.decisions);} catch(error){w.error=`Changes applied, but decision notes could not be saved: ${(error as Error).message}`;await this.persist(w);}
    }
  }
  private async replace(root: string, before: Manifest, after: Manifest) {
    for (const file of Object.keys(before)) if (!Object.hasOwn(after, file)) await fs.rm(await checkedPath(root, file, true), { force: true });
    // Remove empty ancestors to support file↔directory replacements.
    for (const file of Object.keys(before)) {
      let dir = path.posix.dirname(file);
      while (dir !== ".") { await fs.rmdir(await checkedPath(root, dir, true)).catch(e => { if (!["ENOTEMPTY", "ENOENT", "ENOTDIR"].includes(e.code)) throw e; }); dir = path.posix.dirname(dir); }
    }
    for (const [file, data] of Object.entries(after)) await atomicWrite(root, file, data, true);
  }
}
