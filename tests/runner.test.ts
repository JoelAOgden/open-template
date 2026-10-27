import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {Runner} from '../server/runner.js';
import {START_STUB} from '../server/launcher.js';
async function fixture(t:test.TestContext,script:string){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-launcher-'));await fs.writeFile(path.join(root,'start.sh'),script);
 const runner=new Runner(root);t.after(async()=>{await runner.stop();await fs.rm(root,{recursive:true,force:true});});
 const start=async()=>runner.start((await runner.info()).scriptHash!);return {root,runner,start};
}
async function until(check:()=>boolean,timeout=5000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw new Error('Timed out waiting for process state');await delay(20);}}
test('launcher stub fails explicitly without npm or a package manifest',async t=>{
 const {root,runner,start}=await fixture(t,START_STUB);await start();await until(()=>runner.state.status==='error');
 assert.equal(runner.state.exitCode,1);assert.match(runner.state.logLines.join('\n'),/not been implemented/);
 await assert.rejects(fs.access(path.join(root,'package.json')));
});
test('a CLI command can exit successfully without a URL and a failed command reports its exit code',async t=>{
 const {root,runner,start}=await fixture(t,'#!/bin/sh\nprintf "CLI result\\n"\nexit 0\n');
 await start();await until(()=>runner.state.status==='exited');assert.equal(runner.state.exitCode,0);assert.equal(runner.state.detectedLocalUrl,undefined);
 assert.match(runner.state.logLines.join('\n'),/CLI result/);
 await fs.writeFile(path.join(root,'start.sh'),'#!/bin/sh\necho failed >&2\nexit 7\n');
 await start();await until(()=>runner.state.status==='error');assert.equal(runner.state.exitCode,7);
});
test('a background service needs no HTTP URL and Stop terminates its process group',async t=>{
 const {root,runner,start}=await fixture(t,'#!/bin/sh\n(sleep 1; echo leaked > leaked.txt) &\necho running\nwait\n');
 await start();await until(()=>runner.state.logLines.includes('running'));
 assert.equal(runner.state.status,'running');assert.equal(runner.state.detectedLocalUrl,undefined);
 await assert.rejects(start(),/already running/);await runner.stop();assert.equal(runner.state.status,'stopped');
 await delay(1200);await assert.rejects(fs.access(path.join(root,'leaked.txt')));
});
test('changed or linked launchers are rejected before execution',async t=>{
 const {root,runner}=await fixture(t,'#!/bin/sh\nexit 0\n');const hash=(await runner.info()).scriptHash!;
 await fs.writeFile(path.join(root,'start.sh'),'#!/bin/sh\necho unexpected > ran.txt\n');
 await assert.rejects(runner.start(hash),/changed/);await assert.rejects(fs.access(path.join(root,'ran.txt')));
 await fs.rename(path.join(root,'start.sh'),path.join(root,'actual.sh'));await fs.symlink('actual.sh',path.join(root,'start.sh'));
 assert.equal((await runner.info()).script,null);await assert.rejects(runner.start(hash),/Links/);
});
test('a real Go CLI launches through start.sh without Node project files or HTTP',async t=>{
 try{await promisify(execFile)('go',['version']);}catch{t.skip('Go is not installed on this machine');return;}
 const {root,runner,start}=await fixture(t,'#!/bin/sh\nexport GOCACHE="$PWD/.cache/go"\nexport GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off\nexec go run main.go\n');
 await fs.writeFile(path.join(root,'main.go'),'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello from Go") }\n');
 await start();await until(()=>['exited','error'].includes(runner.state.status),90000);
 assert.equal(runner.state.status,'exited',runner.state.logLines.join('\n'));assert.match(runner.state.logLines.join('\n'),/Hello from Go/);
 await assert.rejects(fs.access(path.join(root,'package.json')));
});

test('large build artifacts do not prevent launching but unsafe project links still do',async t=>{
 const {root,runner,start}=await fixture(t,'#!/bin/sh\nexit 0\n');
 await fs.writeFile(path.join(root,'compiled-program'),Buffer.alloc(2*1024*1024));
 await start();await until(()=>runner.state.status==='exited');
 await fs.symlink('compiled-program',path.join(root,'unsafe-link'));
 await assert.rejects(start(),/Links/);
});
