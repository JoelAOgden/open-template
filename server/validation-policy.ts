import type { StageOutput, Workflow, WorkflowStage } from "../shared/workflow.js";

// Preserve warning records from older agents and saved runs.
export function recordValidationWarnings(w: Workflow, stage: WorkflowStage, output: StageOutput | undefined) {
  if (w.validationPolicyVersion !== 1 || !output?.skippedChecks?.length) return;
  w.validationWarnings ??= [];
  for (const skipped of output.skippedChecks) {
    const warning = { ...skipped, stageId: stage.id, attempt: stage.attempts.length, sourceHash: w.sourceHash };
    const index = w.validationWarnings.findIndex(v => v.check === warning.check && v.command === warning.command && v.reason === warning.reason);
    if (index < 0) w.validationWarnings.push(warning); else w.validationWarnings[index] = warning;
  }
  // Absence on a later stage is not proof that a skipped check subsequently passed.
}
