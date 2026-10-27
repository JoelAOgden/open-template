import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ServiceSetup, terminalScript } from "../server/service-setup.js";
import { cliEnvironment, cliPrefix, resolveCli } from "../server/cli-path.js";
import { loginArguments, runSetup } from "../server/service-setup-runner.js";
import type { Provider } from "../shared/agent-settings.js";

async function fixture(t: test.TestContext) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"studio-setup-test-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}
async function fakeCli(root:string, provider:Provider, auth:"yes"|"no"|"bad"="yes") {
  const bin=path.join(cliPrefix(provider,root),"node_modules",".bin");await fs.mkdir(bin,{recursive:true});
  const executable=path.join(bin,provider);
  await fs.writeFile(executable,`#!/usr/bin/env node
const args=process.argv.slice(2);
if(args.includes('--version')) console.log('fixture 1.0');
else if(args.includes('status')) {
 console.log(${JSON.stringify(auth === "bad" ? "secret invalid response" : JSON.stringify({loggedIn:auth === "yes",email:"private@example.com",token:"must-not-return"}))});
 process.exit(${auth === "no" ? 1 : 0});
} else throw new Error('Status must never request a model response');
`,{mode:0o700});return executable;
}
test("incomplete automatic setup cannot launch authentication",async t=>{
 const root=await fixture(t);let opened=false;
 const setup=new ServiceSetup(root,async()=>{opened=true;},async()=>undefined);
 assert.equal((await setup.status("gemini")).installed,false);
 await assert.rejects(setup.launch("gemini","login"),/automatic setup/);
 assert.equal(opened,false);
});
for(const provider of ["codex","claude"] as const) {
 test(`${provider} reports credential status without exposing account or token output`,async t=>{
  const root=await fixture(t);await fakeCli(root,provider);
  const setup=new ServiceSetup(root);
  const signedIn=await setup.status(provider);assert.equal(signedIn.auth,"signed-in");
  assert.doesNotMatch(JSON.stringify(signedIn),/private@example|must-not-return/);
  await fakeCli(root,provider,"no");assert.equal((await setup.status(provider)).auth,"signed-out");
 });
}
test("Gemini installation does not imply verified authentication",async t=>{
 const root=await fixture(t);await fakeCli(root,"gemini");
 const result=await new ServiceSetup(root).status("gemini");
 assert.equal(result.installed,true);assert.equal(result.auth,"unknown");
});
test("malformed Claude authentication response remains unknown",async t=>{
 const root=await fixture(t);await fakeCli(root,"claude","bad");
 assert.equal((await new ServiceSetup(root).status("claude")).auth,"unknown");
});
test("setup launches a private terminal script and rejects arbitrary providers and actions",async t=>{
 const root=await fixture(t);let opened="";
 const setup=new ServiceSetup(root,async script=>{opened=script;},async()=>"/fixture/gemini");
 const result=await setup.launch("gemini","login");assert.match(result.message,/Terminal opened/);
 t.after(()=>fs.rm(path.dirname(opened),{recursive:true,force:true}));
 const text=await fs.readFile(opened,"utf8");
 assert.match(text,/service-setup-runner.ts/);assert.match(text,/'gemini' 'login'/);
 assert.equal((await fs.stat(opened)).mode & 0o777,0o700);
 const env=JSON.parse(await fs.readFile(path.join(path.dirname(opened),"environment.json"),"utf8"));
 assert.ok(env.PATH.includes(cliPrefix("gemini",root)));
 assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);
 await assert.rejects(setup.launch("gemini; touch evil" as Provider,"login"));
 await assert.rejects(setup.launch("gemini","command" as "login"));
});
test("terminal startup failure reports manual fallback and cleans launch files",async t=>{
 const root=await fixture(t);let opened="";
 const setup=new ServiceSetup(root,async script=>{opened=script;throw new Error("No desktop");},async()=>"/fixture/gemini");
 await assert.rejects(setup.launch("gemini","login"),/desktop terminal/);
 await assert.rejects(fs.stat(path.dirname(opened)),{code:"ENOENT"});
});
test("terminal script preserves literal paths and does not execute shell metacharacters",async t=>{
 const root=await fixture(t), script=path.join(root,"launch.command");
 const arg="space ' quote $(touch injected) `touch injected`\nnewline";
 await fs.writeFile(script,terminalScript([process.execPath,"-e","process.stdout.write(process.argv[1])",arg]));
 const result=await promisify(execFile)("/bin/sh",[script],{cwd:root});
 assert.equal(result.stdout,arg);await assert.rejects(fs.stat(path.join(root,"injected")),{code:"ENOENT"});
});
test("managed CLI installation is discovered immediately and uses the same environment as login",async t=>{
 const root=await fixture(t);const binary=await fakeCli(root,"gemini");
 assert.equal(await resolveCli("gemini",root),binary);
 assert.equal(cliEnvironment("gemini",root).PATH!.split(path.delimiter)[0],path.dirname(binary));
 assert.deepEqual(loginArguments("codex"),["login"]);
 assert.deepEqual(loginArguments("claude"),["auth","login"]);
 assert.deepEqual(loginArguments("gemini"),[]);
});
test("terminal runner only launches login and never invokes an installer",async t=>{
 const root=await fixture(t),directory=path.join(root,"terminal"),bin=path.join(root,"bin"),log=path.join(root,"calls.jsonl");
 await fs.mkdir(directory);await fs.mkdir(bin);
 await fs.writeFile(path.join(bin,"gemini"),`#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n');
`,{mode:0o700});
 await fs.writeFile(path.join(directory,"environment.json"),JSON.stringify({PATH:bin,HOME:root}));
 await runSetup("gemini","login",directory);
 const call=JSON.parse((await fs.readFile(log,"utf8")).trim());
 assert.deepEqual(call.args,[]);assert.equal(call.cwd,await fs.realpath(directory));
 await assert.rejects(runSetup("gemini","install" as "login",directory));
});
