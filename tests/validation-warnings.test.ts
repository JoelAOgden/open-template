import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Studio } from "../server/studio.js";
import { Store } from "../server/store.js";
import { atomicWrite } from "../server/files.js";
import type { CodexCall } from "../server/codex-cli.js";
import { StageOutputSchema, type StageOutput, type SkippedCheck } from "../shared/workflow.js";
const skipped: SkippedCheck = {check:"Browser interaction and visual checks",command:"npm run test:e2e",reason:"sandbox-restriction",evidence:"Chromium exited before any scenario: MachPortRendezvousServer registration Permission denied (1100)."};
const done: StageOutput = {status:"completed",summary:"Implementation complete; browser validation skipped with warning.",requirements:[],findings:[],decisions:[],skippedChecks:[skipped]};
async function fixture(t:test.TestContext,run:(call:CodexCall)=>Promise<StageOutput>){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"studio-warnings-"));
 const agent={async status(){return {available:true};},async run(call:CodexCall){call.onSession(call.sessionId??randomUUID());return run(call);}};
 const studio=new Studio(new Store(root),agent);await studio.init();
 t.after(async()=>{await studio.close();await fs.rm(root,{recursive:true,force:true});});return {studio,root,agent};
}
test("environment-only skipped checks allow AI completion and warnings survive acceptance and restart",async t=>{
 const {studio,root,agent}=await fixture(t,async call=>{assert.equal(call.schemaFile,undefined);if(call.writable)await atomicWrite(call.cwd,"app.txt","built");return done;});
 const w=await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:"project"});await studio.workflows.waitForIdle();
 assert.equal(studio.workflows.active!.status,"review");assert.equal(studio.workflows.active!.startup,undefined);
 assert.equal(studio.workflows.active!.validationWarnings?.length,1,"repeated reports deduplicate");
 assert.equal(studio.workflows.active!.recoveries?.length??0,0);
 await studio.workflows.accept(w.id);
 const reopened=new Studio(new Store(root),agent);await reopened.init();
 assert.equal(reopened.workflows.active!.status,"accepted");assert.equal(reopened.workflows.active!.validationWarnings![0].command,"npm run test:e2e");await reopened.close();
});
test("an agent-reported blocked result stops without a recovery agent",async t=>{
 let calls=0;
 const {studio}=await fixture(t,async()=>{calls++;return {...done,status:"blocked",summary:"External service unavailable"};});
 await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:"project"});await studio.workflows.waitForIdle();
 assert.equal(studio.workflows.active!.status,"blocked");assert.equal(calls,1);assert.equal(studio.workflows.active!.recoveries,undefined);
 await assert.rejects(studio.workflows.accept(studio.workflows.active!.id),/Finish the implementation/);
});
test("warning schema requires evidence and permits only environment categories",()=>{
 assert.equal(StageOutputSchema.safeParse({...done,skippedChecks:[{...skipped,evidence:""}]}).success,false);
 assert.equal(StageOutputSchema.safeParse({...done,skippedChecks:[{...skipped,reason:"assertion-failed"}]}).success,false);
});
