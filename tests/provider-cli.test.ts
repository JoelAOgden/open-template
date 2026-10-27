import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentCLIs, CodexCLI, providerArguments, type CodexCall, type CodingAgent } from "../server/codex-cli.js";
import { AgentSettingsSchema, type Provider } from "../shared/agent-settings.js";
const session = "8a1d9072-8ec5-4be3-a6be-f983aa24b3f0";
async function fixture(t: test.TestContext, provider: "gemini" | "claude", mode = "success") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-provider-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "cli.mjs");
  const events = provider === "gemini" ? [
    { type: "init", session_id: session },
    { type: "message", role: "assistant", content: "Built ", delta: true },
    { type: "message", role: "assistant", content: "the café.", delta: true },
    { type: "result", status: mode === "failure" ? "error" : "success" },
  ] : [
    { type: "system", subtype: "init", session_id: session },
    { type: "result", subtype: "success", is_error: mode === "failure", result: "Built the café.", permission_denials: mode === "denied" ? [{tool_name:"Bash"}] : [] },
  ];
  await fs.writeFile(binary, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if(args.includes('--version')) console.log('fixture');
else if(args.includes('--help')) console.log('--output-format --resume --sandbox --approval-mode --allowed-tools --permission-mode --setting-sources --strict-mcp-config --settings');
else {
 let input=''; for await (const chunk of process.stdin) input+=chunk;
 fs.writeFileSync(${JSON.stringify(path.join(root,"input.json"))},JSON.stringify({args,input}));
 const events=${JSON.stringify(mode === "missing" ? events.slice(0,-1) : events)};
 for (const event of events) console.log(JSON.stringify(event));
 if (${JSON.stringify(mode)} === 'wait') setInterval(()=>{}, 1000);
}
`, { mode: 0o700 });
  const controller = new AbortController();
  const sessions: string[] = [], logs: string[] = [];
  let closed = false;
  const agent = new CodexCLI(binary, async () => ({env:{STUDIO_BROWSER_URL:"http://127.0.0.1:1234",STUDIO_BROWSER_TOKEN:"fixture"}, close:async()=>{closed=true;}}), provider);
  const call: CodexCall = {cwd:root,prompt:"Implement; $(never run this as shell)", writable:true, settings:{provider,model:"custom-model",reasoning:null}, resultFile:path.join(root,"response.txt"),signal:controller.signal,onEvent:line=>logs.push(line),onSession:id=>sessions.push(id)};
  return {root, agent, call, sessions, logs, controller, closed:()=>closed};
}
for (const provider of ["gemini", "claude"] as const) {
  test(`${provider} streams, saves response, resumes its exact session and passes model on argv`, async t => {
    const f = await fixture(t, provider);
    assert.equal((await f.agent.run(f.call)).summary,"Built the café.");
    assert.deepEqual(f.sessions,[session]);
    assert.ok(f.logs.length >= 2); assert.ok(f.closed());
    assert.equal(await fs.readFile(f.call.resultFile,"utf8"),"Built the café.");
    await f.agent.run({...f.call, sessionId:session});
    const {args,input} = JSON.parse(await fs.readFile(path.join(f.root,"input.json"),"utf8"));
    assert.equal(input,f.call.prompt); assert.ok(!args.includes(input));
    assert.equal(args[args.indexOf('--resume')+1],session);
    assert.equal(args[args.indexOf('--model')+1],"custom-model");
    assert.ok(!args.includes('--dangerously-skip-permissions')); assert.ok(!args.includes('--yolo'));
  });
  for (const mode of ["failure", "missing"])
    test(`${provider} rejects ${mode} final results even on exit zero`, async t => {
      const f = await fixture(t, provider, mode);
      await assert.rejects(f.agent.run(f.call)); assert.ok(f.closed());
    });
  test(`${provider} Stop terminates the CLI and closes its browser`, async t => {
    const f = await fixture(t, provider,"wait");
    f.call.onSession = () => f.controller.abort();
    await assert.rejects(f.agent.run(f.call)); assert.ok(f.closed());
  });
}
test("Claude permission denials cannot silently complete a stage", async t => {
  const f=await fixture(t,"claude","denied");
  await assert.rejects(f.agent.run(f.call),/permission denied/);
});
test("dispatch uses saved provider and old settings default to Codex", async () => {
  const selected: Provider[] = [];
  const agent = (provider:Provider): CodingAgent => ({
    async status(){selected.push(provider);return {available:true};},
    async run(){selected.push(provider);return {status:"completed",summary:provider,requirements:[],findings:[]};},
  });
  const router = new AgentCLIs({codex:agent("codex"),gemini:agent("gemini"),claude:agent("claude")});
  const settings = AgentSettingsSchema.parse({model:null,reasoning:null});
  await router.status(settings);
  for(const provider of ["gemini","claude"] as const) {
    await router.status({...settings,provider});
    await router.run({settings:{...settings,provider}} as CodexCall);
  }
  assert.deepEqual(selected,["codex","gemini","gemini","claude","claude"]);
  assert.equal(AgentSettingsSchema.safeParse({...settings,provider:"arbitrary-command"}).success,false);
});
test("resume rejects non-ID input before launching a provider", async t => {
  const f=await fixture(t,"gemini");
  assert.throws(()=>providerArguments("gemini",{...f.call,sessionId:"--latest"}));
});
