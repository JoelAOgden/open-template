// Historical data shapes only. No scheduling, request schemas or execution logic.
import type { ComponentSchema } from "./model.js";
import type { z } from "zod";
export type Requirement = { id: string; text: string; disposition: "implement" | "no_change"; reason: string; checks: string[]; unitId: string; changeId: string };
export type PipelineTask = { id: string; title: string; instructions: string; requirementIds: string[]; dependsOn: string[]; areas: string[]; unitId: string; amendments: string[] };
export type TaskGrouping = {
  foundation: { title: string; instructions: string; checks: string[] };
  groups: { id: string; title: string; taskIds: string[]; dependsOn: { groupId: string; reason: string }[] }[];
};
export type WorkUnit = {
  id: string; changeId: string; path: string; kind: string; title: string;
  start: number; end: number; total: number; content: string;
  documentId?: string; sectionId?: string;
};
export type StageKind = "recovery" | "grouping" | "analysis" | "compare" | "reconcile" | "task" | "review" | "integration";
export type StageStatus = "pending" | "running" | "waiting" | "completed" | "blocked" | "failed" | "cancelled";
export type StageInfo = {
  id: string; kind: StageKind; title: string; status: StageStatus; attempt: number;
  startedAt?: string; finishedAt?: string; error?: string; summary?: string;
  unitIds: string[]; taskIds: string[]; runId?: string;
};
export type StageRecord = StageInfo & {
  input: unknown; output?: unknown; logs: string[];
  prompt?: import("./model.js").AgentInput;
};
export type Pipeline = {
  id: string; sessionId: string; snapshotHash: string; sourceHash: string; fingerprint: string;
  createdAt: string; updatedAt: string; status: "planning" | "ready" | "blocked" | "failed" | "cancelled";
  message?: string; error?: string; units: WorkUnit[]; requirements: Requirement[]; tasks: PipelineTask[]; steps: StageInfo[];
  grouping?: TaskGrouping;
  analysisSourcePipelineId?: string;
  reconciliationTotal?: number;
  reconciliationStepIds?: string[];
};
export type PipelineInfo = Pick<Pipeline, "id" | "sessionId" | "createdAt" | "updatedAt" | "status" | "error"> & {
  units: number; requirements: number; tasks: number; completedSteps: number; totalSteps: number;
};
export type TaskProgress = {
  taskId: string; title?: string;
  recoveryInstruction?: string;
  requestDependencyResolution?: boolean;
  implementation?: { sourceHash: string; summary: string };
  dependencyChecks?: { status: "running" | "completed" | "failed" | "cancelled"; logs: string[]; error?: string }[];
  startChecks?: import("./model.js").StartCheck[];
  status: "pending" | "running" | "waiting" | "completed" | "blocked" | "failed";
  summary?: string; waitingOnTaskIds?: string[]; deferredSourceHash?: string; deferralCount?: number;
};
export type RecoveryDecision = {
  action: "repair" | "retry_review" | "resolve_dependencies" | "defer" | "needs_input" | "external_blocker";
  taskId: string | null; prerequisiteTaskIds: string[]; diagnosis: string; strategy: string;
  components: z.infer<typeof ComponentSchema>[];
};
export type RecoveryEvent = {
  id: string; sourceHash: string; failure: string; createdAt: string;
  status: "diagnosing" | "applied" | "stopped" | "failed" | "cancelled";
  decision?: RecoveryDecision; error?: string;
};
