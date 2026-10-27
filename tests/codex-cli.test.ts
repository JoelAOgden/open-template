import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodexCLI, codexArguments, type CodexCall } from "../server/codex-cli.js";

async function fixture(t: test.TestContext, fail = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "fake-codex.mjs");
  await fs.writeFile(binary, `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('--version')) { console.log('fixture'); }
else if(args.includes('--help')) { console.log('--ignore-user-config --ignore-rules --output-last-message --json'); }
else {
  if(args.includes('--output-schema')) throw new Error('Unexpected response schema');
  let prompt=''; for await (const chunk of process.stdin) prompt+=chunk;
  fs.writeFileSync(${JSON.stringify(path.join(root,"input.txt"))}, prompt);
  fs.writeFileSync(${JSON.stringify(path.join(root,"browser-env.json"))}, JSON.stringify({url:process.env.STUDIO_BROWSER_URL,token:process.env.STUDIO_BROWSER_TOKEN,client:process.env.STUDIO_BROWSER_CLIENT,guide:process.env.STUDIO_BROWSER_GUIDE}));
  console.log(JSON.stringify({type:'thread.started',thread_id:'8a1d9072-8ec5-4be3-a6be-f983aa24b3f0'}));
  fs.writeFileSync(args[args.indexOf('-o')+1], ${JSON.stringify("Built the site. Browser checks were unavailable.\nNo JSON report needed.")});
  console.log(JSON.stringify(${fail ? "{type:'turn.failed',error:{message:'Fixture failure'}}" : "{type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}"}));
}
`, {mode:0o700});
  const events: string[] = [], sessions: string[] = [];
  let browserClosed = false;
  const call: CodexCall = {cwd:root,prompt:"Implement the specification.",writable:true,settings:{model:null,reasoning:null},resultFile:path.join(root,"response.txt"),signal:new AbortController().signal,onEvent:event=>events.push(event),onSession:id=>sessions.push(id)};
  return {root,call,events,sessions,browserClosed:()=>browserClosed,agent:new CodexCLI(binary, async () => ({env:{STUDIO_BROWSER_URL:"http://127.0.0.1:1234/",STUDIO_BROWSER_TOKEN:"fixture-token"},close:async()=>{browserClosed=true;}}))};
}
test("CLI streams events and saves a normal final answer without a response schema",async t=>{
  const {root,call,events,sessions,agent,browserClosed}=await fixture(t);
  const result=await agent.run(call);
  assert.equal(result.status,"completed");
  assert.equal(browserClosed(),true);
  assert.match(result.summary,/No JSON report needed/);
  assert.match(result.summary,/Browser checks were unavailable/);
  assert.equal(sessions.length,1);assert.equal(events.length,2);
  assert.equal(await fs.readFile(path.join(root,"input.txt"),"utf8"),call.prompt);
  const browserEnv=JSON.parse(await fs.readFile(path.join(root,"browser-env.json"),"utf8"));
  assert.equal(browserEnv.url,"http://127.0.0.1:1234/");assert.equal(browserEnv.token,"fixture-token");
  assert.ok((await fs.readFile(browserEnv.client,"utf8")).includes("export async function browser"));
  assert.ok((await fs.readFile(browserEnv.guide,"utf8")).includes("Studio Chromium"));
  const args=codexArguments({...call,sessionId:sessions[0]});
  assert.equal(args.includes("--output-schema"),false);
  assert.ok(args.includes("resume"));assert.ok(args.includes('sandbox_mode="workspace-write"'));
  assert.equal(args.includes(call.prompt),false);
});
test("a failed CLI turn cannot advance even if the process exits zero",async t=>{
  const {call,agent,browserClosed}=await fixture(t,true);
  await assert.rejects(agent.run(call),/Fixture failure/);
  assert.equal(browserClosed(),true);
});

test("read-only CLI calls do not receive a browser capability",async t=>{
 const {root,call,agent,browserClosed}=await fixture(t);
 call.writable=false;
 await agent.run(call);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,"browser-env.json"),"utf8")),{});
 assert.equal(browserClosed(),false);
});
