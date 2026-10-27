import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Studio } from "../server/studio.js";
import { Store } from "../server/store.js";
import { saveAIDecisions } from "../server/ai-decisions.js";
import { atomicWrite } from "../server/files.js";
import type { CodexCall } from "../server/codex-cli.js";
import { StageOutputSchema, type StageOutput } from "../shared/workflow.js";
const done: StageOutput = {status:"completed",summary:"Done",requirements:[],findings:[],decisions:[]};
const decision = {key:"deletion-retention",choice:"Keep deleted items for 30 days",reason:"Retention was unspecified"};
async function fixture(t: test.TestContext, run: (call: CodexCall) => Promise<StageOutput>) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"studio-decisions-"));
  const studio=new Studio(new Store(root),{async status(){return {available:true};},async run(call){call.onSession(call.sessionId ?? randomUUID());call.onEvent("agent running");return run(call);}});
  await studio.init();t.after(async()=>{await studio.close();await fs.rm(root,{recursive:true,force:true});});return studio;
}
test("implementation records optional concise decisions without a separate decision call",async t=>{
 const calls:CodexCall[]=[];
 const studio=await fixture(t,async call=>{calls.push(call);await atomicWrite(call.cwd,".studio/decisions.json",JSON.stringify([decision]));return done;});
 await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:"project"});await studio.workflows.waitForIdle();
 const w=studio.workflows.active!;assert.equal(w.status,"review",w.error);assert.equal(w.recoveries,undefined);
 assert.equal(calls.length,w.sections.length+1);assert.deepEqual(w.decisions,[decision]);
 const section=studio.store.project.sections.find(s=>s.slug==="ai-decisions")!;
 const doc=studio.store.project.documents.find(d=>d.sectionId===section.id)!;
 assert.deepEqual(doc.nodes.map(n=>n.type==="list"?n.items:[]),[[`${decision.choice} — ${decision.reason}`]]);
 assert.equal(w.snapshot.project.sections.some(s=>s.slug==="ai-decisions"),false);
 assert.equal(w.changedFiles.some(f=>f.path.includes(".studio/")),false);
});
test("decision updates stay compact; user edits and deletion are never overwritten or recreated",async t=>{
  const studio=await fixture(t,async()=>done),store=studio.store;
  await saveAIDecisions(store,[decision]);await saveAIDecisions(store,[decision]);
  const section=store.project.sections.find(s=>s.slug==="ai-decisions")!;
  let doc=store.project.documents.find(d=>d.sectionId===section.id)!;
  assert.equal(doc.nodes.length,1);
  await saveAIDecisions(store,[{...decision,choice:"Keep deleted items for 14 days"}]);
  assert.equal(doc.nodes.length,1);assert.match(JSON.stringify(doc.nodes),/14 days/);
  const edited=structuredClone(doc);if(edited.nodes[0].type==="list")edited.nodes[0].items=["Delete immediately — my preference"];
  await store.saveDocument(doc.id,edited);await saveAIDecisions(store,[decision]);
  doc=store.project.documents.find(d=>d.id===doc.id)!;assert.match(JSON.stringify(doc.nodes),/my preference/);
  await store.deleteSection(section.id,[{id:doc.id,version:doc.version}]);
  await saveAIDecisions(store,[decision,{key:"another-choice",choice:"Use a compact list",reason:"Layout was unspecified"}]);
  assert.equal(store.project.sections.some(s=>s.slug==="ai-decisions"),false);
});
test("Stop preserves the draft without importing unfinished decisions or spawning a retry",async t=>{
 let reached!:()=>void;const started=new Promise<void>(resolve=>reached=resolve);let calls=0;
 const studio=await fixture(t,async call=>{calls++;await atomicWrite(call.cwd,".studio/decisions.json",JSON.stringify([decision]));reached();await new Promise<void>(resolve=>call.signal.addEventListener("abort",()=>resolve(),{once:true}));return done;});
 await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:"project"});await started;await studio.workflows.stop();
 assert.equal(studio.workflows.active!.status,"paused");assert.equal(calls,1);
 assert.equal(studio.store.project.sections.some(s=>s.slug==="ai-decisions"),false);
});
test("decision schema rejects bloated or multiline entries",()=>{
  assert.equal(StageOutputSchema.safeParse({...done,decisions:[{...decision,choice:"x".repeat(181)}]}).success,false);
  assert.equal(StageOutputSchema.safeParse({...done,decisions:[{...decision,reason:"a\nb"}]}).success,false);
});
test("a subsequent run exposes stable keys and user corrections as authoritative context",async t=>{
  const studio=await fixture(t,async()=>done);await saveAIDecisions(studio.store,[decision]);
  const section=studio.store.project.sections.find(s=>s.slug==="ai-decisions")!;
  const doc=structuredClone(studio.store.project.documents.find(d=>d.sectionId===section.id)!);
  if(doc.nodes[0].type==="list")doc.nodes[0].items=["Delete immediately — user choice"];
  await studio.store.saveDocument(doc.id,doc);
  await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:"project"});await studio.workflows.waitForIdle();
  assert.deepEqual(studio.workflows.active!.decisionContext,[{key:decision.key,text:"Delete immediately — user choice",userEdited:true}]);
});

test("invalid optional decision notes do not create another agent call or block the build",async t=>{
 let calls=0;const studio=await fixture(t,async call=>{calls++;await atomicWrite(call.cwd,".studio/decisions.json","invalid JSON");return done;});
 await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:"project"});await studio.workflows.waitForIdle();
 assert.equal(studio.workflows.active!.status,"review");assert.equal(calls,studio.workflows.active!.stages.length);
 assert.match(studio.workflows.active!.stages[0].attempts[0].logs.join("\n"),/not imported/);
});
