import { Field } from '../../components/ui/Field';
import { ViewHeader, Actions } from '../../components/patterns/View';
import { useConfirm } from "../../components/patterns/ConfirmDialog";
import { Heading, Text } from "../../components/ui/Typography";
import { Input, Label, Textarea } from "../../components/ui/Fields";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import { Workshop } from "./Workshop";
import { workshopState } from "./workshop-view";
import { runStatusLabel } from "./pipeline-view";
import { Bot } from "lucide-react";
import { RobotNotes } from "./RobotNotes";
import { useEffect, useRef, useState } from "react";
import type { WorkflowInfo, WorkflowView } from "../../../shared/workflow";
import { api } from "../../lib/api";

export function WorkflowPanel({ current, act, savedDraft = false, disabled = false }: {
  current?: WorkflowView | null; act?: (route: string, data?: unknown) => Promise<unknown>; savedDraft?: boolean; disabled?: boolean;
}) {
  const confirmAction = useConfirm();
  const [history, setHistory] = useState<WorkflowInfo[]>([]), [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState<WorkflowView | null>(null), [error, setError] = useState("");
  const [stageId, setStageId] = useState(""), [reviewOpen, setReviewOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [fullSpec, setFullSpec] = useState(false), [source, setSource] = useState("project"), [message, setMessage] = useState(""), [fresh, setFresh] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const items = await api<WorkflowInfo[]>("/workflows");
        const id = selected || (!current ? items[0]?.id : undefined);
        const detail = id ? await api<WorkflowView>(`/workflows/${id}`) : null;
        if (alive) { setHistory(items); setLoaded(detail); }
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [selected, current?.id]);
  useEffect(() => { setSelected(""); setStageId(""); }, [current?.id]);
  const w = selected ? loaded?.id === selected ? loaded : null : current ?? loaded;
  useEffect(() => { setReviewOpen(false); setStageId(""); }, [w?.id]);
  const active = !!act && w?.id === current?.id;
  const closed = !current || ["accepted", "dismissed"].includes(current.status);
  const runAction = async (action: string, data: unknown = {}) => {
    setError(""); try { await act?.(action, data); } catch (e) { setError((e as Error).message); }
  };
  return <div className="workflow-panel">
    <ViewHeader className="pipeline-heading"><div><span className="eyebrow">Pipeline</span><Heading level={1}>{workshopState(w).title}</Heading></div>
      {!!history.length && <Select variant="quiet" aria-label="Saved workflow runs" value={selected} onChange={e => { setSelected(e.target.value); setStageId(""); }}><Option value="">Latest run</Option>{history.map(h => <Option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()} · {runStatusLabel(h)}</Option>)}</Select>}
    </ViewHeader>

    <Workshop workflow={w} select={id => { setStageId(id); setReviewOpen(false); requestAnimationFrame(() => notesRef.current?.scrollIntoView({ block: "nearest" })); }} />
    {w?.status === "review" && w.acceptancePolicy !== "automatic" && !reviewOpen && <div className="workshop-next"><Button variant="primary" onClick={() => { setStageId(""); setReviewOpen(true); requestAnimationFrame(() => notesRef.current?.scrollIntoView({ block: "start" })); }}>Review changes</Button></div>}
    {act && closed && <section className="workflow-launch"><Button variant="quiet" aria-expanded={optionsOpen} aria-controls="workflow-options" onClick={() => setOptionsOpen(!optionsOpen)}>{optionsOpen ? "−" : "+"} Advanced</Button>
      {optionsOpen && <div id="workflow-options" className="workflow-options">
        <div className="full-spec-option">
          <Label><Input type="checkbox" aria-describedby="full-spec-description full-spec-warning" checked={fullSpec} onChange={e => setFullSpec(e.target.checked)} /> Review full specification</Label>
          <Text id="full-spec-description">Checks existing code against every section document and implements missing requirements in a draft. Successful changes are applied automatically.</Text>
          <Text id="full-spec-warning" className="full-spec-warning">Warning: this can change code across the project, take longer and use more of your selected service’s allowance than applying recent changes.</Text>
        </div>
        {savedDraft && <Field label="Starting code">
          <Select value={source} onChange={e => setSource(e.target.value)}><Option value="project">Accepted project</Option><Option value="saved-draft">Earlier saved draft</Option></Select></Field>}
        <Button disabled={disabled} onClick={() => { setSelected(""); setStageId(""); void runAction("/workflows", { fullSpec, source }); }}>Build with these options</Button>
      </div>}
    </section>}
    {error && <article className="robot-note" data-warning="true" role="alert"><header><Bot size={18} /><strong>I need your attention</strong></header><Text>{error}</Text></article>}
    {w && <>
      {active && <Actions className="actions">
        {w.acceptancePolicy === "automatic" && ["review", "failed"].includes(w.status) && !w.integrityFailure && w.stages.every(s => ["completed", "skipped"].includes(s.status)) && <Button disabled={disabled || w.applying} onClick={() => void runAction(`/workflows/${w.id}/retry-apply`)}>Retry applying changes</Button>}
        {w.status === "accepted" && w.acceptancePolicy === "automatic" && <Button disabled={disabled} onClick={async () => { if (await confirmAction("Restore the code from before this run? Current specification documents and decision notes will be kept. Restore will refuse if code has changed since this run.", { title: "Restore previous version", confirmLabel: "Restore" })) void runAction(`/workflows/${w.id}/rollback`); }}>Restore previous version</Button>}
        {w.acceptancePolicy === "automatic" && !["accepted", "dismissed"].includes(w.status) ? <Button variant="danger" disabled={disabled || w.applying} onClick={async () => { if (await confirmAction("Cancel this run? All code changes from this run will be discarded. Your specification edits and existing project will be kept.", { title: "Cancel pipeline", confirmLabel: "Discard run" })) void runAction(`/workflows/${w.id}/cancel`); }}>{w.applying ? "Applying changes…" : "Cancel run"}</Button> : w.status === "running" && <Button disabled={disabled} onClick={() => void runAction(`/workflows/${w.id}/stop`)}>Stop</Button>}
        {w.acceptancePolicy !== "automatic" && !["running", "accepted", "dismissed"].includes(w.status) && <Button variant="quiet" disabled={disabled} onClick={async () => { if (await confirmAction("Dismiss this draft? Saved files and history remain; accepted code is unchanged.")) void runAction(`/workflows/${w.id}/dismiss`); }}>Dismiss</Button>}
      </Actions>}
      {active && ["paused", "blocked", "failed"].includes(w.status) && !w.integrityFailure && <article className="robot-note robot-reply">
        <header><Bot size={18} /><strong>Ready to carry on?</strong></header>
        <Textarea aria-label="Resume instructions" placeholder="Leave me a note (optional)…" value={message} onChange={e => setMessage(e.target.value)} />
        <Label><Input type="checkbox" checked={fresh} onChange={e => setFresh(e.target.checked)} /> Start a fresh conversation</Label>
        <Button variant="primary" disabled={disabled} onClick={() => void runAction(`/workflows/${w.id}/resume`, { message, fresh })}>Resume</Button>
      </article>}
      <div ref={notesRef} className="robot-notebook">
        {stageId && <Button variant="quiet" onClick={() => setStageId("")}>All robot notes</Button>}
        <RobotNotes workflow={w} selected={stageId} review={reviewOpen} />
        {active && w.status === "review" && w.acceptancePolicy !== "automatic" && reviewOpen && <Actions className="actions"><Button variant="primary" disabled={disabled} onClick={() => void runAction(`/workflows/${w.id}/accept`)}>{w.validationWarnings?.length ? "Accept changes with warnings" : "Accept changes"}</Button></Actions>}
      </div>
    </>}
  </div>;
}
