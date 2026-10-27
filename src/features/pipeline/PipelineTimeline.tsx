import type { WorkflowView } from '../../../shared/workflow';
import { PipelineNode } from './PipelineNode';
import { workshopState } from './workshop-view';
export function PipelineTimeline({ workflow, select }: { workflow: WorkflowView; select: (id: string) => void ;}) {
  const stages = workflow.stages, state = workshopState(workflow);
  return <div className="workshop-team">
    <div className="workshop-progress"><span>{state.completed} of {stages.length} steps finished</span><progress aria-label="Completed pipeline steps" value={state.completed} max={stages.length} /></div>
    <ol aria-label="Pipeline progress">{stages.map(stage => <PipelineNode key={stage.id} stage={stage} workflow={workflow} working={state.running && stage.id === state.worker?.id} select={select} />)}</ol>
  </div>;
}
