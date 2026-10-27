import { StatusBadge } from "../../components/ui/StatusBadge";
import type { CSSProperties } from 'react';
import type { WorkflowStage, WorkflowView } from '../../../shared/workflow';
import { Button } from '../../components/ui/Button';
import { Check } from 'lucide-react';
import { WorkshopRobot as Robot } from './WorkshopRobot';
import { workerPersonality } from './workshop-view';
import { statusLabel } from './pipeline-view';
export function PipelineNode({ stage, workflow, working, select }: { stage: WorkflowStage; workflow?: WorkflowView | null; working: boolean; select: (id: string) => void ;}) {
  const person = workerPersonality(stage, workflow), done = ['completed', 'skipped'].includes(stage.status);
  return <li key={stage.id} data-state={working ? 'working' : done ? 'done' : 'waiting'}>
    <Button onClick={() => select(stage.id)} aria-label={`${stage.title}: ${statusLabel[stage.status]}`} aria-current={working ? 'step' : undefined} style={{ '--robot-color': person.color } as CSSProperties}>
      <span className="workshop-avatar"><Robot tool={person.badge === 'design' ? 'brush' : person.badge === 'check' ? 'lens' : 'wrench'} small />{done && <Check className="workshop-done" size={15} />}</span>
      <span className="workshop-member"><strong>{stage.title}</strong><StatusBadge status={stage.status}>{working ? `${person.name} is working` : statusLabel[stage.status]}</StatusBadge></span>
    </Button>
  </li>;
}
