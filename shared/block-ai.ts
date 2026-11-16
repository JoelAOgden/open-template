import { z } from "zod";
import { DocumentSchema, NodeSchema } from "./model.js";
import type { Provider } from "./agent-settings.js";

export function imageGenerationUnavailableReason(provider: Provider = "codex"): string | null {
  return provider === "claude"
    ? "Image generation is unavailable with Claude. Choose Codex or Gemini in Settings, or upload an image."
    : null;
}

export const BlockAIRequestSchema = z.object({
  document: DocumentSchema,
  block: NodeSchema.nullable(), // null creates a new image
  prompt: z.string().trim().min(1).max(12000),
}).strict();
export type BlockAIRequest = z.infer<typeof BlockAIRequestSchema>;
export type BlockAIProposal = { node: z.infer<typeof NodeSchema>; imageBase64?: string };
