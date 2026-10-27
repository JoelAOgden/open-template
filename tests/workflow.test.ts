import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Studio } from "../server/studio.js";
import { Store, paragraph } from "../server/store.js";
import { atomicWrite, manifest } from "../server/files.js";
import type { CodexCall, CodingAgent } from "../server/codex-cli.js";
import { codexArguments } from "../server/codex-cli.js";
import type { StageOutput } from "../shared/workflow.js";

const completed: StageOutput = {status:"completed",summary:"Checked",requirements:[],findings:[]};
class FakeAgent implements CodingAgent {
  calls: CodexCall[] = [];
  hook?: (call: CodexCall) => Promise<StageOutput | void>;
  async status() { return {available:true}; }
  async run(call: CodexCall) {
    this.calls.push(call); call.onSession(call.sessionId ?? randomUUID()); call.onEvent('fixture event');
    const output = await this.hook?.(call); if (output) return output;
    if (call.writable) await atomicWrite(call.cwd,"index.txt","working output");
    return completed;
  }
}
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"studio-fixed-")), agent = new FakeAgent();
  const studio = new Studio(new Store(root),agent); await studio.init();
  t.after(async()=>{ await studio.close(); await fs.rm(root,{recursive:true,force:true}); });
  const doc = studio.store.project.documents[0];
  await studio.store.saveDocument(doc.id,{...doc,nodes:[paragraph("Make a working application.")]});
  return {studio,agent,root};
}
const options = {acceptancePolicy:"manual" as const,fullSpec:false,source:"project" as const};
test("one implementation call per scope uses concise prompts, fresh sections, frozen inputs and explicit acceptance",async t=>{
  const {studio,agent} = await fixture(t); const w = await studio.workflows.create(options);
  const doc = studio.store.project.documents[0];
  await studio.store.saveDocument(doc.id,{...doc,nodes:[paragraph("Next run only")]});
  await studio.workflows.waitForIdle(); const saved = studio.workflows.active!;
  assert.equal(saved.status,"review",saved.error);
  assert.equal(saved.stages.length,saved.sections.length+1);
  assert.equal(agent.calls.length,saved.stages.length);
  assert.deepEqual(saved.stages.map(s=>s.kind),["foundation",...saved.sections.map(()=>"section")]);
  for (const [i,call] of agent.calls.entries()) {
    assert.equal(call.sessionId,undefined); assert.equal(call.schemaFile,undefined); assert.equal(call.writable,true);
    assert.ok(call.prompt.length<2100,call.prompt);
    assert.doesNotMatch(call.prompt,/Return JSON|handoff|requirements lists|independent verification/i);
    if(i)assert.ok(call.prompt.includes(`section-${saved.sections[i-1].id}.json`));
    assert.doesNotMatch(call.prompt,/Next run only/);
  }
  assert.equal(saved.recoveries,undefined);
  assert.equal(Object.keys(await manifest(studio.store.codeDir)).length,0);
  await studio.workflows.accept(w.id);
  assert.equal(studio.store.state.appliedSnapshotHash,saved.snapshot.hash);
  assert.notEqual((await studio.store.snapshot()).hash,saved.snapshot.hash);
  assert.equal((await manifest(studio.store.codeDir))["index.txt"].toString(),"working output");
});
test("stop preserves draft and resumes interrupted stage without repeating completed foundation",async t=>{
  const {studio,agent}=await fixture(t); let reached!:()=>void;
  const ready=new Promise<void>(resolve=>reached=resolve);
  agent.hook=async call=>{if(call.prompt.startsWith("Review the current project")){await atomicWrite(call.cwd,"partial.txt","keep me");reached();await new Promise<void>(resolve=>call.signal.addEventListener("abort",()=>resolve(),{once:true}));call.signal.throwIfAborted();}};
  const w=await studio.workflows.create(options);await ready;await studio.workflows.stop();
  assert.equal(studio.workflows.active!.status,"paused");
  assert.equal(studio.workflows.active!.stages[0].attempts.length,1);
  agent.hook=undefined;await studio.workflows.resume(w.id);await studio.workflows.waitForIdle();
  assert.equal(studio.workflows.active!.status,"review",studio.workflows.active!.error);
  assert.equal(studio.workflows.active!.stages[0].attempts.length,1);
  assert.ok(studio.workflows.active!.changedFiles.some(f=>f.path==="partial.txt"));
});
test("pipeline finishes without a launch gate and preserves the generic launcher stub",async t=>{
  const {studio,agent}=await fixture(t);
  const w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
  assert.equal(studio.workflows.active!.status,"review");
  assert.equal(studio.workflows.active!.startup,undefined);
  assert.equal(studio.workflows.active!.stages.some(s=>s.kind === "start"),false);
  assert.ok(agent.calls.every(call=>call.schemaFile===undefined));
  await studio.workflows.accept(w.id);
  assert.match((await manifest(studio.store.codeDir))["start.sh"].toString(),/exit 1/);
});
test("frozen-reference tampering blocks workflow; later draft edits cannot be accepted",async t=>{
  const {studio,agent}=await fixture(t);agent.hook=async call=>{await atomicWrite(path.dirname(call.cwd),"AGENTS.md","tampered");};
  await studio.workflows.create(options);await studio.workflows.waitForIdle();
  assert.equal(studio.workflows.active!.integrityFailure,true);
  await studio.workflows.dismiss(studio.workflows.active!.id);agent.hook=undefined;
  const w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
  await atomicWrite(path.join(studio.store.dataDir,"workflows",w.id,"project/output"),"index.txt","edited");
  await assert.rejects(studio.workflows.accept(w.id),/changed since the last completed step/);
});
test("CLI launch sets sandbox on resume too and keeps prompt off argv",async()=>{
  const args=codexArguments({cwd:"/tmp/output",prompt:"secret prompt",writable:false,sessionId:randomUUID(),settings:{model:null,reasoning:null},schemaFile:"/tmp/schema",resultFile:"/tmp/result",signal:new AbortController().signal,onEvent(){},onSession(){}});
  assert.ok(args.includes('sandbox_mode="read-only"'));assert.ok(args.includes("resume"));assert.ok(args.includes("--ignore-user-config"));assert.equal(args.at(-1),"-");assert.ok(!args.join(" ").includes("secret prompt"));
});
test("a failed call preserves source and stops without any automatic recovery or extra calls",async t=>{
  const {studio,agent}=await fixture(t);
  agent.hook=async call=>{await atomicWrite(call.cwd,"partial.txt","saved");throw new Error("Transport failed");};
  const w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
  assert.equal(agent.calls.length,1);assert.equal(studio.workflows.active!.status,"failed");
  assert.equal(studio.workflows.active!.recoveries,undefined);
  assert.ok(studio.workflows.active!.changedFiles.some(f=>f.path==="partial.txt"));
  agent.hook=undefined;await studio.workflows.resume(w.id);await studio.workflows.waitForIdle();
  assert.equal(agent.calls[1].sessionId,studio.workflows.active!.stages[0].attempts[0].sessionId);
  assert.equal(studio.workflows.active!.status,"review");
});
test("restart preserves paused workflow, and acceptance journal restores partial imports",async t=>{
  const {studio,agent,root}=await fixture(t);await atomicWrite(studio.store.codeDir,"old.txt","accepted");
  const w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
  const prior={...studio.store.state};
  await atomicWrite(studio.store.dataDir,`workflows/${w.id}/accepting.json`,JSON.stringify({prior}));
  await atomicWrite(studio.store.codeDir,"old.txt","partial import");
  await atomicWrite(studio.store.codeDir,"extra.txt","partial import");
  const reopened=new Studio(new Store(root),agent);await reopened.init();
  assert.equal((await manifest(reopened.store.codeDir))["old.txt"].toString(),"accepted");
  assert.equal((await manifest(reopened.store.codeDir))["extra.txt"],undefined);
  assert.equal(reopened.workflows.active!.status,"review");
  await reopened.workflows.accept(w.id);assert.equal(reopened.workflows.active!.status,"accepted");await reopened.close();
});
test("agent exports track document changes and section removal without rewriting original guidance",async t=>{
  const {studio}=await fixture(t);const store=studio.store, section=await store.addSection("Research");
  const original=store.project.documents.find(d=>d.sectionId===section.id)!;
  const doc=await store.saveDocument(original.id,{...original,nodes:[{id:randomUUID(),type:"text",text:"working application",bold:false,italic:false,color:"default"}]});
  const skill=await fs.readFile(path.join(store.skillDir,`skills/${section.slug}/SKILL.md`),"utf8");
  const exported=path.join(store.dataDir,`workspace/spec/${section.slug}/${doc.id}.md`);
  assert.match(await fs.readFile(exported,"utf8"),/working application/);
  assert.equal(await fs.readFile(path.join(store.skillDir,`skills/${section.slug}/SKILL.md`),"utf8"),skill);
  await store.deleteSection(section.id,store.project.documents.filter(d=>d.sectionId===section.id).map(d=>({id:d.id,version:d.version})));
  await assert.rejects(fs.access(exported));
  await assert.rejects(fs.access(path.join(store.dataDir,`workspace/.agents/skills/${section.slug}/SKILL.md`)));
});


test("empty sections add no calls, but removals still receive a section pass",async t=>{
 const {studio,agent}=await fixture(t);
 for(const doc of [...studio.store.project.documents])await studio.store.saveDocument(doc.id,{...doc,nodes:[]});
 let w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
 assert.equal(agent.calls.length,1);assert.equal(w.stages.length,1);await studio.workflows.accept(w.id);
 const doc=studio.store.project.documents[0];await studio.store.saveDocument(doc.id,{...doc,nodes:[paragraph("Add search")]});
 w=await studio.workflows.create(options);await studio.workflows.waitForIdle();assert.equal(w.stages.length,1);assert.equal(w.stages[0].kind,"section");await studio.workflows.accept(w.id);
 const current=studio.store.project.documents[0];await studio.store.deleteDocument(current.id,current.version);
 w=await studio.workflows.create(options);await studio.workflows.waitForIdle();assert.equal(w.stages.length,1);assert.equal(w.stages[0].kind,"section");
 assert.equal(w.sections[0].id,doc.sectionId);
});

test("legacy resume keeps saved code and completed builds, archives old stages, and never launches old review calls",async t=>{
 const {studio,agent,root}=await fixture(t);const view=await studio.workflows.create(options);await studio.workflows.waitForIdle();
 const w=studio.workflows.active!;
 const old=w.stages.map((s,i)=>({...s,id:i?`section-${i-1}-build`:"foundation-build",kind:i?"section-build" as const:"foundation-build" as const,status:i?"pending" as const:"completed" as const}));
 old.push({id:"verify",title:"Old verification",kind:"verify" as never,sessionKey:"verify",status:"pending",attempts:[]});
 w.stages=old;delete w.executionMode;w.status="failed";w.error="Old review failed";
 const refs={...w.referenceHashes};const oldAttempts=JSON.parse(JSON.stringify(w.stages));
 await atomicWrite(studio.store.dataDir,`workflows/${w.id}/workflow.json`,JSON.stringify(w));
 const restarted=new Studio(new Store(root),agent);await restarted.init();t.after(()=>restarted.close());
 const calls=agent.calls.length;await restarted.workflows.resume(view.id);await restarted.workflows.waitForIdle();
 const next=restarted.workflows.active!;
 assert.equal(next.status,"review",next.error);assert.equal(next.executionMode,"prompt");
 assert.deepEqual(next.archivedStages,oldAttempts);
 assert.equal(agent.calls.length-calls,w.sections.length,"completed foundation was not repeated");
 assert.ok(agent.calls.slice(calls).every(c=>c.sessionId===undefined&&c.prompt.includes("supersedes frozen instructions")));
 for(const [file,value] of Object.entries(refs))assert.equal(next.referenceHashes[file],value,"original frozen files unchanged");
 assert.equal(next.stages.some(s=>s.kind==="verify"),false);
 assert.ok(next.changedFiles.some(f=>f.path==="index.txt"));
 await restarted.workflows.accept(next.id);
});

test("migration retains already discovered unfinished work without reviving the old review loop",async t=>{
 const {studio,agent}=await fixture(t);const {id}=await studio.workflows.create(options);await studio.workflows.waitForIdle();
 const w=studio.workflows.active!;
 w.stages=w.stages.map((s,i)=>({...s,id:i?`section-${i-1}-build`:"foundation-build",kind:i?"section-build":"foundation-build"}));
 const output={...completed,status:"blocked" as const,summary:"Missing search",findings:[{reference:"Features",issue:"Search absent",evidence:"No search control"}]};
 w.stages.push({id:"verify",title:"Old verification",kind:"verify",sessionKey:"verify",status:"blocked",attempts:[{number:1,status:"blocked",startedAt:new Date().toISOString(),prompt:"old",logs:[],output}]});
 await atomicWrite(path.join(studio.store.dataDir,`workflows/${id}/project`),"results/verify.json",JSON.stringify(output));
 delete w.executionMode;w.status="blocked";
 const calls=agent.calls.length;
 agent.hook=async call=>{
  const context=JSON.parse(await fs.readFile(path.join(call.cwd,"../results/context.json"),"utf8"));
  assert.deepEqual(context.previousUnfinishedWork,[{step:"Old verification",response:"../results/verify.json"}]);
 };
 await studio.workflows.resume(id);await studio.workflows.waitForIdle();
 assert.equal(w.status,"review",w.error);assert.equal(agent.calls.length-calls,1);
 assert.equal(w.stages.some(s=>s.kind==="verify"),false);
});

test("one changed section uses one focused call; multiple sections retain foundation and section passes",async t=>{
 const {studio,agent}=await fixture(t);
 let w=await studio.workflows.create(options);await studio.workflows.waitForIdle();await studio.workflows.accept(w.id);
 const edit=async(index:number,text:string)=>{const doc=studio.store.project.documents[index];await studio.store.saveDocument(doc.id,{...doc,nodes:[paragraph(text)]});};
 await edit(0,"Add a search box");
 let count=agent.calls.length;
 w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
 assert.equal(agent.calls.length-count,1);assert.deepEqual(w.stages.map(s=>s.kind),["section"]);
 assert.match(agent.calls.at(-1)!.prompt,/Features/);assert.match(agent.calls.at(-1)!.prompt,/Respect the whole specification/);
 await studio.workflows.accept(w.id);
 await edit(0,"Add search filters");await edit(1,"Use a compact green design");
 count=agent.calls.length;w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
 assert.equal(agent.calls.length-count,3);assert.deepEqual(w.stages.map(s=>s.kind),["foundation","section","section"]);
});

test("new projects with only one populated section still receive foundation first",async t=>{
 const {studio}=await fixture(t);
 for(const doc of studio.store.project.documents.slice(1))await studio.store.saveDocument(doc.id,{...doc,nodes:[]});
 const w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
 assert.deepEqual(w.stages.map(s=>s.kind),["foundation","section"]);
});

test("section prompts select frozen default guidance and a generic custom fallback",async t=>{
 const {studio,agent}=await fixture(t);
 await studio.store.addSection("Accessibility");
 const custom=studio.store.project.documents.at(-1)!;
 await studio.store.saveDocument(custom.id,{...custom,nodes:[paragraph("Support keyboard navigation")]});
 await studio.workflows.create(options);await studio.workflows.waitForIdle();
 const w=studio.workflows.active!;
 assert.equal(w.status,"review",w.error);
 assert.equal(agent.calls.length,w.sections.length+1);
 assert.match(agent.calls[0].prompt,/working, cohesive result/);
 assert.match(agent.calls[0].prompt,/don't defer essential work/);
 const expected:Record<string,RegExp>={features:/changed behaviour/,design:/Open the visual references/,architecture:/updated technical requirements/,testing:/meaningful checks/,accessibility:/Let the section's content guide/};
 for(const section of w.sections){
   const stage=w.stages.find(s=>s.sectionId===section.id)!;
   const prompt=stage.attempts[0].prompt;
   assert.match(prompt,expected[section.slug]);
   assert.doesNotMatch(prompt,/\{focus\}|\{sectionDiff\}/);
   const focus=section.slug==="accessibility"?"generic":section.slug;
   assert.ok(w.referenceHashes[`prompts/section-${focus}.md`]);
 }
});

test("service selection persists and existing workflows retain their service on resume", async t => {
  const {studio,agent,root}=await fixture(t);
  await studio.updateSettings({provider:"gemini",model:"gemini-model",reasoning:null});
  agent.hook=async()=>{throw new Error("Interrupted provider");};
  const w=await studio.workflows.create(options);await studio.workflows.waitForIdle();
  await studio.updateSettings({provider:"claude",model:"sonnet",reasoning:null});
  agent.hook=undefined;
  await studio.workflows.resume(w.id);await studio.workflows.waitForIdle();
  assert.ok(agent.calls.every(call=>call.settings.provider==="gemini"));
  assert.equal(studio.workflows.active!.settings.model,"gemini-model");
  const reopened=new Store(root);await reopened.init();
  assert.equal(reopened.settings.provider,"claude");
  await assert.rejects(studio.updateSettings({provider:"gemini",model:null,reasoning:"high"}),/only for Codex/);
});
