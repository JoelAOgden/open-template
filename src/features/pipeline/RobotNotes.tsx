import { ViewHeader } from '../../components/patterns/View';
import { Heading, Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { Bot, StickyNote } from 'lucide-react';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { WorkflowView } from '../../../shared/workflow';
import { latestUpdate, workerPersonality } from './workshop-view';

export function robotNotes(w: WorkflowView, selected = '') {
  const notes: { id: string; name: string; section: string; color: string; text: string; warning?: boolean ;}[] = [];
  for (const stage of w.stages.filter(s => !selected || s.id === selected)) {
    const person = workerPersonality(stage, w), attempt = stage.attempts.at(-1);
    const text = attempt?.output?.summary ?? attempt?.error ?? latestUpdate(stage);
    if (text) notes.push({ id: stage.id, ...person, section: stage.title, text, warning: stage.status === 'failed' || stage.status === 'blocked' });
  }
  for (const [i, warning] of (w.validationWarnings ?? []).entries()) {
    const stage = w.stages.find(s => s.id === warning.stageId), person = workerPersonality(stage, w);
    notes.push({ id: `warning-${i}`, ...person, section: 'Something to check', text: `I couldn’t check ${warning.check}. ${warning.reason === 'sandbox-restriction' ? 'The environment didn’t allow it.' : 'The tools needed for this check weren’t available.'} This remains unverified.`, warning: true });
  }
  for (const [i, decision] of (w.decisions ?? []).entries()) notes.push({ id: `decision-${i}`, name: 'Your team', section: 'A decision I made', color: '#edc484', text: `${decision.choice}\n${decision.reason}` });
  if (w.error) notes.push({ id: 'error', name: 'Your team', section: 'I need your attention', color: '#edc484', text: w.error, warning: true });
  return notes;
}
function Note({ note }: { note: ReturnType<typeof robotNotes>[number] ;}) {
  const [expanded, setExpanded] = useState(false);
  const long = note.text.length > 320;
  return <article className="robot-note" data-warning={note.warning} style={{ '--note-color': note.color } as CSSProperties}>
    <header><Bot size={18} /><strong>{note.name}</strong><span>{note.section}</span></header>
    <Text className={!expanded && long && !note.warning ? 'robot-note-preview' : undefined}>{note.text}</Text>
    {long && !note.warning && <Button variant="quiet" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Fold note' : 'Read whole note'}</Button>}
  </article>;
}
export function RobotNotes({ workflow, selected = '', review = false }: { workflow: WorkflowView; selected?: string; review?: boolean ;}) {
  const notes = robotNotes(workflow, selected);
  return <section className="robot-notes" aria-label="Robot notes">
    <ViewHeader alignment="start" className="robot-notes-heading"><StickyNote size={17} /><Heading level={2}>{review ? 'Here’s what we worked on' : 'Notes from your team'}</Heading></ViewHeader>
    {review && <Text className="robot-notes-caption">These are the team’s reports. Take a look before accepting the work.</Text>}
    {notes.length ? <div className="robot-notes-grid">{notes.map(note => <Note key={`${workflow.id}-${note.id}`} note={note} />)}</div>
      : <Text className="robot-notes-caption">No notes yet. Updates will appear here as the work progresses.</Text>}
  </section>;
}
