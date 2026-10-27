// Read-only access to saved records from the removed pipeline.
import fs from "node:fs/promises";
import { z } from "zod";
import type { Pipeline, PipelineInfo, StageRecord } from "../shared/pipeline-history.js";
import { AppError, checkedPath } from "./files.js";
import type { Store } from "./store.js";
export class PipelineHistory {
  constructor(private store: Store) {}
  async get(id: string): Promise<Pipeline> {
    if (!z.string().uuid().safeParse(id).success) throw new AppError("Invalid pipeline ID.");
    try { return await this.store.load<Pipeline>(`pipelines/${id}/pipeline.json`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("Pipeline not found.", 404); throw error; }
  }
  async step(id: string, stepId: string): Promise<StageRecord> {
    await this.get(id);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(stepId)) throw new AppError("Invalid step ID.");
    try { return await this.store.load<StageRecord>(`pipelines/${id}/steps/${stepId}.json`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("Step not found.", 404); throw error; }
  }
  async list(): Promise<PipelineInfo[]> {
    const dir = await checkedPath(this.store.dataDir, "pipelines");
    let ids: string[];
    try { ids = await fs.readdir(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    const result: PipelineInfo[] = [];
    for (const id of ids.filter((id) => z.string().uuid().safeParse(id).success)) {
      let p: Pipeline;
      try { p = await this.get(id); } catch (e) { if (e instanceof AppError && e.status === 404) continue; throw e; }
      result.push({ id, sessionId: p.sessionId, createdAt: p.createdAt, updatedAt: p.updatedAt, status: p.status, error: p.error,
        units: p.units.length, requirements: p.requirements.length, tasks: p.tasks.length,
        completedSteps: p.steps.filter((s) => s.status === "completed").length, totalSteps: p.steps.length });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
