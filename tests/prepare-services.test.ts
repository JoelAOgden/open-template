import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tools from "../cli-tools.json";
import { prepareServices, installArguments, serviceReady } from "../scripts/prepare-services.mjs";

async function fixture(t:test.TestContext) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"open-template-bundle-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
async function fakeInstall(args:string[]) {
 const prefix=args[args.indexOf('--prefix')+1],provider=path.basename(prefix) as keyof typeof tools;
 const tool=tools[provider];
 assert.ok(args.includes(`${tool.package}@${tool.version}`));assert.ok(args.includes('--registry=https://registry.npmjs.org'));
 await fs.mkdir(path.join(prefix,'node_modules',tool.package),{recursive:true});
 await fs.writeFile(path.join(prefix,'node_modules',tool.package,'package.json'),JSON.stringify({version:tool.version}));
 await fs.mkdir(path.join(prefix,'node_modules','.bin'),{recursive:true});
 await fs.writeFile(path.join(prefix,'node_modules','.bin',provider),'#!/bin/sh\nexit 0\n',{mode:0o700});
}
test('app setup prepares all pinned services once and subsequent startup works offline',async t=>{
 const root=await fixture(t),calls:string[][]=[];
 await prepareServices({root,install:async args=>{calls.push(args);await fakeInstall(args);},log(){}});
 assert.equal(calls.length,3);
 for(const [provider,tool] of Object.entries(tools))assert.equal(await serviceReady(root,provider,tool),true);
 await prepareServices({root,install:async()=>{throw new Error('Must not download again');},log(){}});
});
test('missing executable and outdated package trigger automatic repair',async t=>{
 const root=await fixture(t);await prepareServices({root,install:fakeInstall,log(){}});
 const prefix=path.join(root,'.studio-local','cli','gemini');
 await fs.rm(path.join(prefix,'node_modules','.bin','gemini'));
 const calls:string[][]=[];const install=async(args:string[])=>{calls.push(args);await fakeInstall(args);};
 await prepareServices({root,install,log(){}});assert.equal(calls.length,1);
 await fs.writeFile(path.join(prefix,'node_modules',tools.gemini.package,'package.json'),JSON.stringify({version:'0.0.1'}));
 await prepareServices({root,install,log(){}});assert.equal(calls.length,2);
});
test('download failure stops setup, preserves prepared tools and retries only remaining services',async t=>{
 const root=await fixture(t);let calls=0;
 await assert.rejects(prepareServices({root,install:async args=>{calls++;if(calls===2)throw new Error('Offline');await fakeInstall(args);},log(){}}),/Offline/);
 assert.equal(calls,2);assert.equal(await serviceReady(root,'codex',tools.codex),true);
 calls=0;await prepareServices({root,install:async args=>{calls++;await fakeInstall(args);},log(){}});assert.equal(calls,2);
});
test('installer cannot report readiness without producing a pinned executable',async t=>{
 const root=await fixture(t);
 await assert.rejects(prepareServices({root,install:async()=>{},log(){}}),/required executable/);
});
test('normal app installation and startup both prepare included services',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 for(const hook of ['postinstall','predev','prestart'])assert.equal(manifest.scripts[hook],'node scripts/prepare-services.mjs');
 for(const [provider,tool] of Object.entries(tools)) {
  const args=installArguments('/tmp/open template',provider,tool);
  assert.equal(args[args.indexOf('--prefix')+1],`/tmp/open template/.studio-local/cli/${provider}`);
  assert.equal(args.at(-1),`${tool.package}@${tool.version}`);
 }
});
