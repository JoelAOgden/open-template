import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workshop } from '../src/features/pipeline/Workshop.js';
import { WorkflowPanel } from '../src/features/pipeline/WorkflowPanel.js';
import { robotNotes } from '../src/features/pipeline/RobotNotes.js';
import { latestUpdate, workshopState, workerPersonality, workerActivity } from '../src/features/pipeline/workshop-view.js';
import type { WorkflowStage, WorkflowView } from '../shared/workflow.js';
const stage=(id:string,status:WorkflowStage['status'],logs:string[]=[]):WorkflowStage=>({id,title:id,kind:id==='foundation'?'foundation':'section',sectionId:id,sessionKey:id,status,attempts:[{number:1,status:'running',prompt:'',startedAt:'',logs}]});
const message=(text:string)=>JSON.stringify({type:'item.completed',item:{type:'agent_message',text}});
const workflow=(status:WorkflowView['status']='running')=>({id:'run',status,executionMode:'prompt',sections:[{id:'design',slug:'design'}],stages:[stage('foundation','completed'),stage('design','running',[message('Arranging the navigation.')]),stage('testing','pending')]} as WorkflowView);

test('speech bubbles use public messages only and handle partial events safely',()=>{
 const s=stage('design','running',[message('Old update'),message('**Arranging** the navigation.'),JSON.stringify({type:'item.completed',item:{type:'reasoning',text:'Private reasoning'}}),JSON.stringify({type:'item.completed',item:{type:'command_execution',aggregated_output:'shell output'}}),'{"type":']);
 assert.equal(latestUpdate(s),'Arranging the navigation.');
 assert.equal(latestUpdate(stage('design','running',['raw command output'])),undefined);
 assert.ok(latestUpdate(stage('design','running',[message('A long update '.repeat(50))]))!.length<=220);
});
test('paused, failed and completed states never reuse live progress or animate work',()=>{
 const w=workflow();assert.equal(workshopState(w).bubble,'Arranging the navigation.');
 assert.equal(workshopState(w).completed,1);
 for(const status of ['paused','failed','blocked','review','accepted','dismissed'] as const){
  const view=workshopState({...w,status});assert.equal(view.running,false);assert.equal(view.hasUpdate,false);assert.notEqual(view.bubble,'Arranging the navigation.');
  assert.doesNotMatch(renderToStaticMarkup(createElement(Workshop,{workflow:{...w,status},select(){}})),/data-working="true"/);
 }
});
test('workshop represents actual stages, custom workers, and empty runs without invented progress',()=>{
 const w=workflow();
 const html=renderToStaticMarkup(createElement(Workshop,{workflow:w,select(){}}));
 assert.equal((html.match(/data-working="true"/g)??[]).length,1);
 assert.equal((html.match(/aria-current="step"/g)??[]).length,1);
 assert.match(html,/Arranging the navigation/);
 assert.equal(workerPersonality(w.stages[1],w).name,'Dot');
 assert.equal(workerPersonality(stage('custom','pending'),w).name,'Orbit');
 const single={...w,stages:[w.stages[1]]};
 assert.doesNotMatch(renderToStaticMarkup(createElement(Workshop,{workflow:single,select(){}})),/foundation/);
 assert.equal(workshopState(null).completed,0);
 assert.match(workshopState(null).bubble,/Specification/);
});

test('robot notes keep warnings and decisions visible when a particular robot is selected',()=>{
 const w=workflow();
 w.validationWarnings=[{stageId:'foundation',attempt:1,sourceHash:'',check:'Mobile layout',command:'private command',evidence:'raw logs',reason:'sandbox-restriction'}];
 w.decisions=[{key:'navigation',choice:'Use a left sidebar.',reason:'Keeps navigation visible.'}];
 w.error='The request could not finish.';
 const notes=robotNotes(w,'design');
 assert.ok(notes.some(n=>n.text.includes('Mobile layout') && n.warning));
 assert.ok(notes.some(n=>n.text.includes('Use a left sidebar.')));
 assert.ok(notes.some(n=>n.text===w.error));
 assert.ok(notes.every(n=>!n.text.includes('private command') && !n.text.includes('raw logs')));
});
test('pipeline presents robot notes without technical inspector panels',()=>{
 const w=workflow('review');
 w.stages[1].attempts[0].output={status:'completed',summary:'Updated the layout. Browser checks remain unverified.',requirements:[],findings:[]};
 const html=renderToStaticMarkup(createElement(WorkflowPanel,{current:w}));
 assert.match(html,/Robot notes/);assert.match(html,/Browser checks remain unverified/);
 for(const label of ['All steps','Frozen inputs','Exact prompt','Live events and logs','Historical requirements','Code changes','Updates &amp; technical details']) assert.ok(!html.includes(label),label);
});

test('exhibit assigns a distinct work routine to every default section and a custom fallback',()=>{
 const w=workflow();
 for(const [slug,activity] of [['design','design'],['features','build'],['architecture','plan'],['testing','inspect'],['custom','write']] as const){
  const worker=stage(slug,'running');
  const view={...w,sections:[{id:slug,slug}],stages:[worker]} as WorkflowView;
  assert.equal(workerActivity(worker,view),activity);
  const html=renderToStaticMarkup(createElement(Workshop,{workflow:view,select(){}}));
  assert.ok(html.includes(`data-activity="${activity}"`));
  assert.match(html,/data-active="true"/);
  assert.ok(!html.includes('Say hello') && !html.includes('Give robot') && !html.includes('Pick a tool'));
  for(const status of ['paused','failed','review','accepted'] as const){
   assert.match(renderToStaticMarkup(createElement(Workshop,{workflow:{...view,status},select(){}})),/data-active="false"/);
  }
 }
 assert.equal(workerActivity(stage('foundation','running'),w),'build');
});

test('Gemini and Claude public updates exclude user messages and thinking blocks',()=>{
 const gemini=JSON.stringify({type:'message',role:'assistant',content:'Editing the layout.'});
 assert.equal(latestUpdate(stage('design','running',[gemini,JSON.stringify({type:'message',role:'user',content:'User prompt'})])),'Editing the layout.');
 const claude=JSON.stringify({type:'assistant',message:{content:[{type:'thinking',thinking:'Private reasoning'},{type:'text',text:'Checking the layout.'},{type:'tool_use',name:'Bash'}]}});
 assert.equal(latestUpdate(stage('design','running',[claude])),'Checking the layout.');
});
