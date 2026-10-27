import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ModelIdSchema, ReasoningSchema, type ModelOption } from "../shared/agent-settings.js";
import { readSafe } from "./files.js";

// Read only the installed CLI's cached public catalogue. No authentication or
// personal configuration is exposed, and opening Settings makes no AI request.
export async function cachedModels(codexDir = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")): Promise<ModelOption[]> {
  try {
    const cache = z.object({ models: z.array(z.unknown()) }).parse(
      JSON.parse((await readSafe(codexDir, "models_cache.json", false, 10 * 1024 * 1024)).toString()),
    );
    const entries = cache.models.flatMap((item) => {
      const model = z.object({
        slug: ModelIdSchema, display_name: z.string().min(1).max(120),
        visibility: z.string(), priority: z.number().optional(),
        supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
        default_reasoning_level: z.string().optional(),
      }).safeParse(item);
      if (!model.success || model.data.visibility !== "list") return [];
      const m = model.data;
      const reasoning = m.supported_reasoning_levels.flatMap(({ effort }) => {
        const parsed = ReasoningSchema.safeParse(effort);
        return parsed.success ? [parsed.data] : [];
      });
      const defaultReasoning = ReasoningSchema.safeParse(m.default_reasoning_level);
      return [{ id: m.slug, name: m.display_name, reasoning: [...new Set(reasoning)],
        defaultReasoning: defaultReasoning.success ? defaultReasoning.data : undefined, priority: m.priority ?? 100 }];
    });
    const seen = new Set<string>();
    return entries.sort((a, b) => a.priority - b.priority).filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id); return true;
    }).map(({ priority: _, ...model }) => model);
  } catch { return []; } // Missing/older caches still allow an explicit model ID.
}
