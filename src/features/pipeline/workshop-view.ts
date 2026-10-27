import type { WorkflowStage, WorkflowView } from '../../../shared/workflow';

export function currentWorker(w?: WorkflowView | null) {
  if (!w) return undefined;
  const stages = [...w.stages, ...(w.executionMode !== 'prompt' ? w.recoveries ?? [] : [])];
  return stages.find(s => s.status === 'running') ?? stages.find(s => ['failed', 'blocked', 'stopped'].includes(s.status))
    ?? stages.find(s => s.status === 'pending') ?? stages.at(-1);
}
export function latestUpdate(stage?: WorkflowStage): string | undefined {
  for (const line of [...stage?.attempts.at(-1)?.logs ?? []].reverse()) {
    try {
      const event = JSON.parse(line);
      // Only public agent messages, never reasoning, command output or fabricated summaries.
      const publicText = event.type === 'item.completed' && event.item?.type === 'agent_message' ? event.item.text
        : event.type === 'message' && event.role === 'assistant' ? event.content
          : event.type === 'assistant' && Array.isArray(event.message?.content)
            ? event.message.content.filter((block: { type?: string; text?: unknown ;}) => block.type === 'text' && typeof block.text === 'string').map((block: { text: string ;}) => block.text).join(' ')
            : undefined;
      if (typeof publicText !== 'string') continue;
      const text = publicText.replace(/```[\s\S]*?```/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
      if (text) return text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text;
    } catch { /* Partial JSON and process logs are not public progress messages. */ }
  }
}
export function workshopState(w?: WorkflowView | null) {
  const worker = currentWorker(w);
  const running = w?.status === 'running';
  const update = running ? latestUpdate(worker) : undefined;
  const content: Record<string, [string, string]> = {
    ready: ['Ready to build', 'Your changes are lined up.'],
    running: ['Your app is taking shape', worker ? `Working on ${worker.title}.` : 'Getting ready to work.'],
    paused: ['Taking a break', 'Your work is saved. Resume when you’re ready.'],
    blocked: ['A little help needed', 'I couldn’t finish this step. Your work is saved.'],
    failed: ['A little help needed', 'I couldn’t finish this step. Your work is saved.'],
    review: ['Ready for a look', 'The work is ready for you to review.'],
    accepted: ['Changes are in', 'Your project has been updated.'],
    dismissed: ['Put aside for now', 'This draft is saved in your history.'],
  };
  const [title, fallback] = w?.rolledBack ? ["Previous version restored", "Your specification edits are kept for the next run."] : w?.cancelled ? ["Run cancelled", "This run’s code changes were discarded. Your project is unchanged."] : w?.applying ? ["Applying changes", "Saving the completed changes to your project."] : w && ["review","failed"].includes(w.status) && w.acceptancePolicy === "automatic" && w.stages.every(s=>["completed","skipped"].includes(s.status)) ? ["Changes need attention", w.error ?? "Automatic application could not finish. Your draft is preserved."] : w ? content[w.status] : ['Let’s build something', 'Add your ideas to Specification, then choose Build app.'];
  return {
    worker, running, title, bubble: update ?? fallback, hasUpdate: !!update,
    completed: w?.stages.filter(s => ['completed', 'skipped'].includes(s.status)).length ?? 0
  };
}
export function workerPersonality(stage?: WorkflowStage, w?: WorkflowView | null) {
  const slug = (stage?.kind.startsWith('foundation') || ['building-first-project', 'implementing-changes'].includes(stage?.kind ?? '')) ? 'foundation' : w?.sections.find(s => s.id === stage?.sectionId)?.slug;
  const personalities: Record<string, { name: string; color: string; badge: string; }> = {
    foundation: { name: 'Pip', color: 'var(--palette-74)', badge: 'build' },
    features: { name: 'Bolt', color: 'var(--palette-7)', badge: 'bolt' },
    design: { name: 'Dot', color: 'var(--palette-189)', badge: 'design' },
    architecture: { name: 'Arch', color: 'var(--palette-190)', badge: 'build' },
    testing: { name: 'Scout', color: 'var(--palette-191)', badge: 'check' },
  };
  return personalities[slug ?? ''] ?? { name: 'Orbit', color: 'var(--palette-192)', badge: 'star' };
}

export type WorkshopActivity = 'design' | 'build' | 'plan' | 'inspect' | 'write';
export function workerActivity(stage?: WorkflowStage, w?: WorkflowView | null): WorkshopActivity {
  if (stage?.kind.startsWith('foundation') || ['building-first-project', 'implementing-changes'].includes(stage?.kind ?? '')) return 'build';
  if (stage && ['review', 'verify', 'start', 'repair', 'recovery'].includes(stage.kind)) return 'inspect';
  const slug = w?.sections.find(s => s.id === stage?.sectionId)?.slug;
  return slug === 'design' ? 'design' : slug === 'features' ? 'build' : slug === 'architecture' ? 'plan' : slug === 'testing' ? 'inspect' : 'write';
}
