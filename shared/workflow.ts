import { z } from "zod";
import type { AgentSettings } from "./agent-settings.js";
import type { FileChange, Snapshot, StartCheck } from "./model.js";

export const AIDecisionSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  choice: z.string().trim().min(1).max(180).regex(/^[^\r\n]+$/),
  reason: z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/),
}).strict();
export type AIDecision = z.infer<typeof AIDecisionSchema>;
export const SkippedCheckSchema = z.object({
  check: z.string().trim().min(1).max(160),
  command: z.string().trim().min(1).max(500),
  reason: z.enum(["sandbox-restriction", "unavailable-test-infrastructure"]),
  evidence: z.string().trim().min(1).max(2000),
}).strict();
export type SkippedCheck = z.infer<typeof SkippedCheckSchema>;
export type ValidationWarning = SkippedCheck & { stageId: string; attempt: number; sourceHash: string };
export const StageOutputSchema = z.object({
  status: z.enum(["completed", "blocked", "failed"]),
  summary: z.string().min(1),
  decisions: z.array(AIDecisionSchema).max(8).optional(),
  skippedChecks: z.array(SkippedCheckSchema).max(30).optional(),
  requirements: z.array(z.object({ reference: z.string(), requirement: z.string(), evidence: z.string() }).strict()),
  findings: z.array(z.object({ reference: z.string(), issue: z.string(), evidence: z.string() }).strict()),
}).strict();
export type StageOutput = z.infer<typeof StageOutputSchema>;
export const stageOutputJSONSchema = {
  type: "object", additionalProperties: false, required: ["status", "summary", "requirements", "findings", "decisions", "skippedChecks"],
  properties: {
    skippedChecks: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["check", "command", "reason", "evidence"], properties: {
      check: {type:"string",minLength:1,maxLength:160}, command: {type:"string",minLength:1,maxLength:500},
      reason: {type:"string",enum:["sandbox-restriction","unavailable-test-infrastructure"]}, evidence: {type:"string",minLength:1,maxLength:2000},
    } } },
    decisions: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["key", "choice", "reason"], properties: { key: {type:"string", pattern:"^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength:64}, choice:{type:"string",minLength:1,maxLength:180,pattern:"^[^\\r\\n]+$"}, reason:{type:"string",minLength:1,maxLength:100,pattern:"^[^\\r\\n]+$"} } } },
    status: { type: "string", enum: ["completed", "blocked", "failed"] }, summary: { type: "string" },
    requirements: { type: "array", items: { type: "object", additionalProperties: false, required: ["reference", "requirement", "evidence"], properties: { reference: { type: "string" }, requirement: { type: "string" }, evidence: { type: "string" } } } },
    findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["reference", "issue", "evidence"], properties: { reference: { type: "string" }, issue: { type: "string" }, evidence: { type: "string" } } } },
  },
};
export type StageKind = "implementing-changes" | "building-first-project" | "foundation" | "section" | "foundation-analysis" | "foundation-build" | "section-analysis" | "section-inspect" | "section-build" | "review" | "repair" | "verify" | "start" | "recovery";
export type StageAttempt = {
  number: number; status: "running" | "completed" | "blocked" | "failed" | "stopped";
  startedAt: string; finishedAt?: string; prompt: string; sessionId?: string; resumedSessionId?: string;
  logs: string[]; output?: StageOutput; error?: string; sourceHash?: string;
};
export type WorkflowStage = {
  promptTemplate?: string;
  focusTemplate?: string;
  nodeType?: import("./pipeline-nodes.js").PipelineNodeType;
  id: string; title: string; kind: StageKind; sectionId?: string; sessionKey: string;
  status: "pending" | "running" | "completed" | "blocked" | "failed" | "stopped" | "skipped";
  attempts: StageAttempt[];
};
export type SectionChange = { id: string; name: string; slug: string; removed: boolean; diffs: string[]; documents: string[]; skill: string };
export type Workflow = {
  acceptancePolicy?: "automatic" | "manual";
  pipelineMode?: "first-project" | "single-section" | "small-update" | "multi-section";
  diffStats?: {version:1;added:number;deleted:number;imagesChanged:boolean};
  rolledBack?: boolean;
  cancellationRequested?: boolean;
  applying?: boolean;
  cancelled?: boolean;
  workspaceRoot?: string;
  runtimePlatform?: import("./runtime-platform.js").RuntimePlatform;
  version: 1; id: string; createdAt: string; updatedAt: string;
  status: "ready" | "running" | "paused" | "blocked" | "failed" | "review" | "accepted" | "dismissed";
  snapshot: Snapshot; baselineHash: string | null; baseSourceHash: string; sourceHash: string;
  source: "project" | "saved-draft"; settings: AgentSettings; sections: SectionChange[]; stages: WorkflowStage[];
  sessions: Record<string, string>; changedFiles: FileChange[]; referenceHashes: Record<string, string>;
  executionMode?: "prompt";
  archivedStages?: WorkflowStage[];
  validationPolicyVersion?: 1;
  runtimePolicyVersion?: 1;
  validationWarnings?: ValidationWarning[];
  verificationRepairs?: Record<string, { attempts: number; fingerprints: string[] }>;
  recoveries?: WorkflowStage[];
  decisions?: AIDecision[];
  decisionContext?: { key: string; text: string; userEdited: boolean }[];
  recoveryFingerprints?: string[];
  startup?: StartCheck; error?: string; integrityFailure?: boolean; replies: { text: string; createdAt: string }[];
};
export type WorkflowInfo = Pick<Workflow, "id" | "createdAt" | "updatedAt" | "status" | "error" | "cancelled" | "rolledBack" | "applying" | "acceptancePolicy"> & { completed: number; total: number };
export type WorkflowView = Omit<Workflow, "snapshot" | "referenceHashes"> & { snapshotHash: string; references: string[] };
