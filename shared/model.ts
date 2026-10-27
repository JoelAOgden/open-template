import { z } from "zod";

const text = z.string().max(40000);
const label = z.string().min(1).max(200);
const blockTitle = z.string().max(200).regex(/^[^\r\n]*$/).optional();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const NodeSchema = z.discriminatedUnion("type", [
  z
    .object({
      id,
      title: blockTitle,
      type: z.literal("text"),
      text,
      bold: z.boolean(),
      italic: z.boolean(),
      color: z.enum(["default", "blue", "green", "amber"]),
    })
    .strict(),
  z
    .object({ id, title: blockTitle, type: z.literal("heading"), text, level: z.enum(["2", "3"]) })
    .strict(),
  z
    .object({
      id,
      title: blockTitle,
      type: z.literal("list"),
      items: z.array(text).max(200),
      ordered: z.boolean(),
    })
    .strict(),
  z
    .object({
      id,
      title: blockTitle,
      type: z.literal("table"),
      rows: z
        .array(z.array(z.string().max(4000)).min(1).max(12))
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      id,
      title: blockTitle,
      type: z.literal("image"),
      assetId: z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp|gif|svg)$/),
      alt: z.string().max(1000),
    })
    .strict(),
]);
export type DocNode = z.infer<typeof NodeSchema>;
export const DocumentSchema = z
  .object({
    id,
    sectionId: id,
    title: label,
    nodes: z.array(NodeSchema),
    assetRefs: z.array(z.string()),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type Document = z.infer<typeof DocumentSchema>;
export const SectionSchema = z.object({
  id,
  slug: z.string(),
  displayName: label,
  skillId: z.string(),
  documentIds: z.array(id),
});
export type Section = z.infer<typeof SectionSchema>;
export type Project = {
  name: string;
  sections: Section[];
  documents: Document[];
};

export const ComponentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: label }).strict(),
  z.object({ type: z.literal("paragraph"), text }).strict(),
  z
    .object({
      type: z.literal("steps"),
      items: z
        .array(z.object({ title: label, detail: text }).strict())
        .min(1)
        .max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal("notice"),
      tone: z.enum(["info", "warning", "success"]),
      title: label,
      text,
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      title: label,
      columns: z.array(label).min(1).max(10),
      rows: z.array(z.array(text).max(10)).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("comparison"),
      title: label,
      options: z
        .array(
          z
            .object({
              title: label,
              benefits: z.array(text).max(10),
              tradeoffs: z.array(text).max(10),
            })
            .strict(),
        )
        .min(2)
        .max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("diagram"),
      title: label,
      nodes: z.array(z.object({ id, label }).strict()).min(1).max(20),
      edges: z.array(z.object({ from: id, to: id }).strict()).max(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("checklist"),
      title: label,
      items: z.array(z.object({ text, checked: z.boolean() }).strict()).max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal("decision"),
      title: label,
      question: text,
      options: z.array(label).min(1).max(6),
    })
    .strict(),
]);
export type PlanComponent = z.infer<typeof ComponentSchema>;
export const ProposalSchema = z.union([
  z.object({
    documentId: id,
    reason: text,
    nodes: z.array(NodeSchema).max(300),
  }).strict(),
  z.object({
    type: z.literal("create_document"),
    sectionId: id,
    title: label,
    reason: text,
    nodes: z.array(NodeSchema).min(1).max(300),
  }).strict(),
]);
export const PlanSchema = z
  .object({
    summary: text
      .min(1)
      .describe(
        "Summarize the plan in one or two sentences. Put implementation details in components.",
      ),
    components: z.array(ComponentSchema).min(1).max(60),
    proposals: z.array(ProposalSchema).max(10),
  })
  .strict()
  .superRefine((plan, ctx) => {
    for (const c of plan.components) {
      if (c.type === "diagram") {
        const ids = new Set(c.nodes.map((n) => n.id));
        if (
          ids.size !== c.nodes.length ||
          c.edges.some((e) => !ids.has(e.from) || !ids.has(e.to))
        )
          ctx.addIssue({
            code: "custom",
            message: "Diagram references must use unique, existing nodes.",
          });
      }
      if (
        c.type === "table" &&
        c.rows.some((r) => r.length !== c.columns.length)
      )
        ctx.addIssue({
          code: "custom",
          message: "Table rows must match columns.",
        });
    }
  });
export type Plan = z.infer<typeof PlanSchema>;
// Outcomes retained solely for reading historical runs.
export type AgentOutcome = "completed" | "blocked" | "failed";
export type Revision = Plan & {
  grouping?: import("./pipeline-history.js").TaskGrouping;
  pipelineId?: string;
  tasks?: import("./pipeline-history.js").PipelineTask[];
  requirements?: import("./pipeline-history.js").Requirement[];
  id: string;
  createdAt: string;
  snapshotHash?: string;
  proposalStatus: Record<string, "accepted" | "discarded">;
};
export type Snapshot = {
  hash: string;
  project: Project;
  markdown: Record<string, string>;
  skills: Record<string, string>;
};
export type AgentInput = {
  prompt: string;
  responseSchema: Record<string, unknown>;
  settings?: import("./agent-settings.js").AgentSettings;
};
export type PromptInfo = {
  id: string;
  kind: "analysis" | "plan" | "discussion" | "execution";
  createdAt: string;
  sessionId: string;
};
export type PromptRecord = PromptInfo & AgentInput;
export type DebugFileInfo = {
  path: string;
  kind: "text" | "image" | "binary";
  size: number;
};
export type DebugFile = DebugFileInfo & {
  text: string | null;
  assetId?: string;
};
export type DebugFileIndex = { snapshotHash: string; files: DebugFileInfo[] };
export type DefinitionDiff = {
  baseSnapshotHash: string | null;
  candidateSnapshotHash: string;
  changes: {
    path: string;
    kind: "added" | "modified" | "deleted";
    sectionId?: string;
    documentId?: string;
    summary?: string;
    description?: string;
    diff: string;
  }[];
};
export type PlanningContext = {
  definitionDiff: DefinitionDiff;
  sectionIds: string[];
  documentIds: string[];
  projectFiles: string[];
  files: {
    path: string;
    reason: string;
    content: string | null;
    truncated: boolean;
  }[];
};
export type Refinement = { sectionId: string | null; title: string };
export type PlanSession = {
  pipelineId?: string;
  id: string;
  rebuild?: boolean;
  refinement?: Refinement;
  baseSnapshotHash: string | null;
  candidateSnapshotHash: string;
  snapshot: Snapshot;
  planningContext?: PlanningContext;
  instructions?: string;
  currentRevision: string | null;
  revisions: Revision[];
  recovery?: Revision;
  executionFailure?: ExecutionFailure;
  checkpoint?: CheckpointInfo;
  draft?: DraftConversation;
  messages: { role: "user"; text: string; createdAt: string }[];
  status: "planning" | "ready" | "blocked" | "error";
  error?: string;
  logs: string[];
};
export type FileChange = {
  path: string;
  kind: "added" | "modified" | "deleted";
  beforeHash: string | null;
  afterHash: string | null;
  before: string | null;
  after: string | null;
  binary: boolean;
  diff: string;
};
export type ExecutionFailure = {
  runId: string;
  planRevisionId: string;
  snapshotHash: string;
  status: "blocked" | "error" | "paused" | "review";
  outcome?: AgentOutcome;
  summary?: string;
  error?: string;
  imported: false;
  approvedPlan: Plan;
  changedFiles: FileChange[];
  logs: string[];
  components?: PlanComponent[];
  proposals?: z.infer<typeof ProposalSchema>[];
  startup?: StartCheck;
};
export type Run = {
  recovery?: import("./pipeline-history.js").RecoveryEvent[];
  pipelineId?: string;
  taskProgress?: import("./pipeline-history.js").TaskProgress[];
  id: string;
  rebuild?: boolean;
  refinement?: Refinement;
  settings?: import("./agent-settings.js").AgentSettings;
  sessionId: string;
  planRevisionId: string;
  status: "running" | "blocked" | "error" | "paused" | "review" | "imported" | "dismissed";
  outcome?: AgentOutcome;
  tempWorkdir: string;
  logs: string[];
  changedFiles: FileChange[];
  error?: string;
  summary?: string;
  createdAt: string;
  checkpoint?: CheckpointInfo;
  resumedFromRunId?: string;
  draftId?: string;
  snapshotHash?: string;
  components?: PlanComponent[];
  proposals?: z.infer<typeof ProposalSchema>[];
  proposalStatus?: Record<string, "accepted" | "discarded">;
  fullyImplemented?: boolean;
  startup?: StartCheck;
};
// Historical npm/HTTP check records are retained for saved-run inspection only.
export type StartCheck = {
  status: "running" | "passed" | "failed" | "cancelled";
  sourceHash: string;
  command: "npm run start";
  script?: string;
  startedAt: string;
  finishedAt?: string;
  url?: string;
  error?: string;
  logs: string[];
};
export type DraftConversation = {
  id: string;
  messages: { text: string; createdAt: string }[];
};
export type CheckpointInfo = {
  file?: string;
  runId: string;
  baseHash: string;
  resultHash: string;
  fileCount: number;
};
export type RunInfo = Pick<Run, "id" | "status" | "createdAt" | "summary"> & {
  fileCount: number;
};
export type RunnerState = {
  status: "stopped" | "starting" | "running" | "stopping" | "exited" | "error";
  pid?: number;
  exitCode?: number | null;
  exitSignal?: string | null;
  finishedAt?: string;
  startedAt?: string;
  command: string;
  cwd: "project_src" | "project";
  logLines: string[];
  detectedLocalUrl?: string;
};
export type StartInfo = {
  filename?: "start.sh" | "start.ps1";
  script: string | null;
  scriptHash: string | null;
  error?: string;
};
export type StudioState = {
  workspace?: { path: string; key: string; layout: "legacy" | "folder" };
  workflow?: import("./workflow.js").WorkflowView | null;
  settings: import("./agent-settings.js").AgentSettings;
  project: Project;
  session: PlanSession | null;
  run: Run | null;
  appliedSnapshotHash: string | null;
  checkpoint?: CheckpointInfo;
  draftRunId?: string;
  implementationPending?: boolean;
  busy: boolean;
  runner: RunnerState;
  startInfo: StartInfo;
};
export type TreeEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: TreeEntry[];
};

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
