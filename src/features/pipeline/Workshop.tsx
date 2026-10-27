import { Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { type CSSProperties } from 'react';
import { WorkshopRobot as Robot, type RobotTool } from './WorkshopRobot';
import { Check, Pause, CircleAlert, Wrench, Paintbrush, Search, StickyNote } from 'lucide-react';
import type { WorkflowView } from '../../../shared/workflow';
import { PipelineTimeline } from './PipelineTimeline';
import { workshopState, workerPersonality, workerActivity } from './workshop-view';

export function Workshop({ workflow, select }: { workflow?: WorkflowView | null; select: (id: string) => void ;}) {
  const state = workshopState(workflow), personality = workerPersonality(state.worker, workflow);
  const stages = workflow?.stages ?? [];
  const status = workflow?.status ?? 'empty';
  const activity = workerActivity(state.worker, workflow);
  const tool: RobotTool = activity === 'design' ? 'brush' : activity === 'inspect' ? 'lens' : activity === 'build' ? 'wrench' : 'pencil';
  const working = state.running && state.worker?.status === 'running';
  return <section className="workshop robot-room workshop-exhibit" data-status={status} data-activity={activity} data-active={working} aria-label="App workshop">
    <div className="workshop-scene">
      <div className="room-topline"><span><i />{personality.name}’s workshop</span></div>
      <div className="room-light" aria-hidden="true" />
      <div className="room-pegboard" aria-hidden="true"><span>TOOL KIT</span><Wrench size={25} /><Paintbrush size={25} /><Search size={25} /></div>
      <Button className="room-notepad" disabled={!state.worker} onClick={() => state.worker && select(state.worker.id)} aria-label="Read robot’s notes"><StickyNote size={20} /><span>My notes</span><i /><i /><i /></Button>
      <div className="room-shelf" aria-hidden="true"><span className="room-book" /><span className="room-book" /><span className="room-pot"><i /><i /><i /></span></div>
      <div className="workshop-builder" key={`${workflow?.id ?? 'empty'}-${state.worker?.id ?? 'welcome'}`} style={{ '--robot-color': personality.color } as CSSProperties}>
        <div className="workshop-bubble" role="status" aria-live="polite" aria-atomic="true">
          <small>{state.hasUpdate ? `${personality.name} · latest update` : state.running ? `${personality.name} · ${state.worker?.title ?? 'Getting started'}` : personality.name}</small>
          <Text>{state.bubble}</Text>
        </div>
        <div className="workshop-worker" data-working={working}>
          <Robot tool={tool} activity={activity} />
        </div>
      </div>
      <div className="workshop-app" aria-label="Illustration of the app being built">
        <div className="workshop-app-top"><span /><span /><span /><small>Your app</small></div>
        <div className="workshop-app-content">
          <div className="workshop-app-nav"><i /><i /><i /><i /></div>
          <div className="workshop-app-page"><div className="workshop-app-title" /><div className="workshop-app-subtitle" />
            <div className="workshop-app-tiles">{[0, 1, 2, 3].map(i => <div key={i} className={workflow && state.completed / Math.max(stages.length, 1) >= (i + 1) / 4 ? 'built' : ''}><span /><i /><i /></div>)}</div>
          </div>
        </div>
        {['review', 'accepted'].includes(status) && <span className="workshop-app-stamp"><Check size={20} /><span>{status === 'accepted' ? 'Applied' : workflow?.acceptancePolicy==='automatic' ? workflow.applying?'Applying':'Not applied' : 'Ready to review'}</span></span>}
        {['paused', 'failed', 'blocked'].includes(status) && <span className="workshop-app-stamp attention">{status === 'paused' ? <Pause size={18} /> : <CircleAlert size={18} />}<span>{status === 'paused' ? 'Work saved' : 'Needs attention'}</span></span>}
      </div>
      <div className="workshop-bench" aria-hidden="true"><span /><span /><span /></div>

    </div>
    {!!stages.length && workflow && <PipelineTimeline workflow={workflow} select={select} />}
  </section>;
}
