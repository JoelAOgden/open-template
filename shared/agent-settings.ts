import { z } from "zod";

export const ReasoningSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export const ModelIdSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const ProviderSchema = z.enum(["codex", "gemini", "claude"]);
export type Provider = z.infer<typeof ProviderSchema>;
export const providerLabel = (provider: Provider = "codex") => ({ codex: "Codex CLI", gemini: "Gemini CLI", claude: "Claude Code CLI" })[provider];
export const AgentSettingsSchema = z.object({
  provider: ProviderSchema.optional(), // Older saved settings and runs use Codex.
  model: ModelIdSchema.nullable(),
  reasoning: ReasoningSchema.nullable(),
}).strict();
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;
export type Reasoning = z.infer<typeof ReasoningSchema>;
export type ModelOption = { id: string; name: string; reasoning: Reasoning[]; defaultReasoning?: Reasoning };
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { model: null, reasoning: null };
export const reasoningLabel = (effort: Reasoning) => ({
  none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High",
  xhigh: "Extra high", max: "Max", ultra: "Ultra",
})[effort];
