import { CodeBlock, Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import { providerLabel } from "../../../shared/agent-settings";
import { useEffect, useState } from "react";
import type { Pipeline, PipelineInfo, StageRecord } from "../../../shared/pipeline-history";
import { api } from "../../lib/api";

export function PipelineHistory() {
  const [history, setHistory] = useState<PipelineInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [selectedStep, setSelectedStep] = useState("");
  const [step, setStep] = useState<StageRecord | null>(null);
  const [view, setView] = useState<"input" | "prompt" | "output" | "logs" | "schema">("output");
  const [error, setError] = useState("");
  const id = selected || history[0]?.id;
  const stepId = selectedStep || pipeline?.steps.find((s) => s.status === "running")?.id || pipeline?.steps.at(-1)?.id;
  // Archived records retain the original step ID and their old attempt count.
  // Use the live summary for navigation so every attempt stays reachable.
  const currentStep = pipeline?.steps.find((s) => s.id === stepId || s.id === step?.id);
  useEffect(() => {
    let active = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const result = await api<PipelineInfo[]>("/pipelines"); if (active) { setHistory(result); setError(""); } }
      catch (e) { if (active) setError((e as Error).message); }
      finally { pending = false; }
    };
    void refresh();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setPipeline(null); setStep(null); setSelectedStep("");
    if (!id) return;
    let active = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const result = await api<Pipeline>(`/pipelines/${id}`); if (active) setPipeline(result); }
      catch (e) { if (active) setError((e as Error).message); }
      finally { pending = false; }
    };
    void refresh();
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    setStep(null);
    if (!id || !stepId) return;
    let active = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const result = await api<StageRecord>(`/pipelines/${id}/steps/${stepId}`); if (active) setStep(result); }
      catch (e) { if (active) setError((e as Error).message); }
      finally { pending = false; }
    };
    void refresh();
    return () => { active = false; };
  }, [id, stepId]);
  const content = !step ? "" : view === "input" ? JSON.stringify(step.input, null, 2)
    : view === "output" ? (step.output === undefined ? "No saved response." : JSON.stringify(step.output, null, 2))
      : view === "prompt" ? step.prompt?.prompt ?? "No saved prompt."
        : view === "schema" ? JSON.stringify(step.prompt?.responseSchema ?? {}, null, 2) : step.logs.join("\n");
  return <section aria-label="Pipeline history" className="debug-pipeline">
    <Text className="settings-note">Read-only records from the removed pipeline. Nothing here can resume or execute.</Text>
    {error && <Text role="alert">{error}</Text>}
    {!history.length ? <Text>No saved pipeline history.</Text> : <>
      <Select aria-label="Pipeline history" value={id} onChange={(e) => setSelected(e.target.value)}>
        {history.map((p) => <Option key={p.id} value={p.id}>{new Date(p.createdAt).toLocaleString()} · {p.status === "ready" ? "plan ready" : p.status} · {p.tasks} tasks</Option>)}
      </Select>
      {pipeline && <>
        <Text role="status" className="settings-note">{pipeline.units.length} change units · {pipeline.requirements.length} requirements · {pipeline.tasks.length} tasks · {pipeline.steps.filter((s) => s.status === "completed").length} completed calls{pipeline.steps.some((s) => s.status === "running") ? ` · ${pipeline.steps.find((s) => s.status === "running")!.kind} was running` : ""}</Text>
        <Text className="settings-note">Analysis {pipeline.analysisSourcePipelineId ? "reused · " : ""}{pipeline.analysisSourcePipelineId ? pipeline.units.length : pipeline.steps.filter((s) => s.kind === "analysis" && s.status === "completed").length}/{pipeline.units.length}{pipeline.reconciliationTotal !== undefined ? ` · Reconciliation ${pipeline.steps.filter((s) => s.status === "completed" && (pipeline.reconciliationStepIds ? pipeline.reconciliationStepIds.includes(s.id) : s.kind === "reconcile")).length}/${pipeline.reconciliationTotal}` : ""}</Text>
        {pipeline.reconciliationStepIds && <Text className="settings-note">{pipeline.grouping || pipeline.steps.some(s => s.kind === "grouping") ? "Foundation and improvement groups reference every original task exactly once. Earlier plans and analysis remain in history." : "One comparison of all tasks, followed by checks of identified relationships only. Earlier reconciliation calls remain in history."}</Text>}
        {pipeline.grouping && <details><summary>Foundation and group prerequisites</summary>
          <Text>First: {pipeline.grouping.foundation.title}</Text>
          {pipeline.grouping.groups.map(group => <div key={group.id}><strong>{group.title}</strong> · {group.taskIds.length} original tasks
            <Text>{group.dependsOn.length ? group.dependsOn.map(dep => `${pipeline.grouping!.groups.find(g => g.id === dep.groupId)?.title}: ${dep.reason}`).join("; ") : "Ready after foundation"}</Text>
          </div>)}
        </details>}
        {pipeline.error && <Text role="alert">{pipeline.error}</Text>}
        <details className="pipeline-coverage"><summary>Coverage and task order</summary>
          {pipeline.units.map((unit) => <details key={unit.id}>
            <summary>{unit.title} · {unit.start}–{unit.end}/{unit.total}</summary>
            <code>{unit.id}</code>
            <Text className="settings-note">{unit.path} · {unit.kind}</Text>
            <Button onClick={() => { setSelectedStep(`analyse_${unit.id}`); setView("input"); }}>Source</Button>
            {pipeline.requirements.filter((r) => r.unitId === unit.id).map((r) => <div key={r.id} className="pipeline-requirement">
              <strong>{r.text}</strong><Text>{r.disposition === "no_change" ? "No code change: " : "Implementation: "}{r.reason}</Text>
              <Text className="settings-note">{r.id}</Text>
              <ul>{r.checks.map((check, i) => <li key={i}>{check}</li>)}</ul>
              <Text>Tasks: {pipeline.tasks.filter((t) => t.requirementIds.includes(r.id)).map((t) => t.title).join(", ") || "None"}</Text>
            </div>)}
          </details>)}
          <ol>{pipeline.tasks.map((task) => <li key={task.id}><details><summary>{task.title}</summary>
            <Text>{task.instructions}</Text><Text className="settings-note">{task.id}</Text>
            {task.amendments.map((text, i) => <Text key={i}>{text}</Text>)}
            <Text>Depends on: {task.dependsOn.map((id) => pipeline.tasks.find((t) => t.id === id)?.title ?? id).join(", ") || "None"}</Text>
          </details></li>)}</ol>
        </details>
        <div className="pipeline-layout">
          <nav aria-label="Pipeline calls" className="pipeline-steps">
            <Button aria-pressed={!selectedStep} onClick={() => setSelectedStep("")}>Latest saved call</Button>
            {pipeline.steps.map((s) => <Button key={s.id} aria-current={stepId === s.id ? "step" : undefined} onClick={() => setSelectedStep(s.id)}>
              <span>{s.kind} · {s.status}</span><strong>{s.title}</strong><small>{s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : "Queued"} · attempt {s.attempt}{pipeline.reconciliationStepIds && s.kind === "reconcile" && !pipeline.reconciliationStepIds.includes(s.id) ? " · earlier strategy" : ""}</small>
            </Button>)}
          </nav>
          <div className="pipeline-detail">
            {step && <>
              <Text>{step.title} · {step.status}{step.startedAt ? ` · ${Math.max(0, Math.round(((step.finishedAt ? Date.parse(step.finishedAt) : Date.now()) - Date.parse(step.startedAt)) / 1000))}s` : ""}</Text>
              {step.error && <Text role="alert">{step.error}</Text>}
              {currentStep && currentStep.attempt > 1 && <Select variant="compact" aria-label="Call attempt" value={stepId} onChange={(e) => setSelectedStep(e.target.value)}>
                <Option value={currentStep.id}>Latest · {currentStep.attempt}</Option>
                {Array.from({ length: currentStep.attempt - 1 }, (_, i) => <Option key={i} value={`${currentStep.id}-attempt-${i + 1}`}>Attempt {i + 1}</Option>)}
              </Select>}
              <div className="debug-views" aria-label="Pipeline call content">
                {(["input", "prompt", "output", "logs", "schema"] as const).map((name) => <Button key={name} aria-pressed={view === name} onClick={() => setView(name)}>{name[0].toUpperCase() + name.slice(1)}</Button>)}
              </div>
              {step.prompt?.settings && <Text className="settings-note">{providerLabel(step.prompt.settings.provider)} · {step.prompt.settings.model ?? "Default model"} · {step.prompt.settings.reasoning ?? "Default reasoning"}</Text>}
              <CodeBlock className="debug-content" aria-label="Pipeline call details" tabIndex={0}>{content}</CodeBlock>
            </>}
          </div>
        </div>
      </>}
    </>}
  </section>;
}
