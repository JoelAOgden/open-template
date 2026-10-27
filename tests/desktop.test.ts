import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {DesktopBridge} from '../server/desktop.js';
import {launcher, launcherGuidance, hostPlatform} from '../server/launcher.js';
import {terminalScript} from '../server/service-setup.js';
import {cliInvocation} from '../server/cli-path.js';

test('desktop folder responses are correlated and unknown messages cannot execute actions',async()=>{
 const input=new PassThrough(),output=new PassThrough();let stopped=0;
 const bridge=new DesktopBridge(input,output,async()=>{stopped++;});bridge.listen();
 const first=bridge.pickFolder(),one=JSON.parse(output.read().toString());
 const second=bridge.pickFolder(),two=JSON.parse(output.read().toString());
 input.write(JSON.stringify({type:'execute',command:'anything'})+'\n');
 input.write(JSON.stringify({type:'folder-result',id:two.id,path:null})+'\n');
 input.write(JSON.stringify({type:'folder-result',id:one.id,path:'C:\\My Projects'})+'\n');
 assert.equal(await first,'C:\\My Projects');assert.equal(await second,null);assert.equal(stopped,0);
 input.end();
});
test('loss of desktop host cancels outstanding folder selection and shuts down backend',async()=>{
 const input=new PassThrough(),output=new PassThrough();let stopped=0;
 const bridge=new DesktopBridge(input,output,async()=>{stopped++;});bridge.listen();
 const pending=bridge.pickFolder();const rejected=assert.rejects(pending,/host closed/);input.end();await rejected;assert.equal(stopped,1);
});
test('Windows uses a fixed PowerShell launcher and instructions; Unix retains POSIX shell',()=>{
 assert.equal(hostPlatform('win32'),'windows');
 const windows=launcher('windows');assert.equal(windows.filename,'start.ps1');assert.match(windows.binary,/WindowsPowerShell/);
 assert.equal(windows.args.at(-1),'.\\start.ps1');assert.match(windows.stub,/exit 1/);
 assert.match(launcherGuidance('windows'),/PowerShell 5.1/);
 assert.equal(launcher('macos').filename,'start.sh');assert.equal(launcher('linux').binary,'/bin/sh');
});
test('Windows login quotes literal arguments and invokes JavaScript CLIs through Node',()=>{
 assert.equal(terminalScript(['C:\\Program Files\\node.exe',"a'b",'$(untrusted)'],'win32'),"& 'C:\\Program Files\\node.exe' 'a''b' '$(untrusted)'\r\n");
 assert.deepEqual(cliInvocation('C:\\tools\\cli.js',['login']),{binary:process.execPath,args:['C:\\tools\\cli.js','login']});
});

test('desktop backend starts on an assigned port with isolated data and stops through its private pipe',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {spawn}=await import('node:child_process');
 const {createInterface}=await import('node:readline');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'desktop data '));
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,OPEN_TEMPLATE_DESKTOP:'1',OPEN_TEMPLATE_RESOURCE_DIR:process.cwd(),OPEN_TEMPLATE_DATA_DIR:directory},stdio:['pipe','pipe','pipe']});
 t.after(async()=>{child.kill();await fs.rm(directory,{recursive:true,force:true});});
 let errors='';child.stderr.on('data',data=>{errors+=data;});
 const closed=new Promise<number|null>(resolve=>child.on('close',resolve));
 const ready=await new Promise<{port:number}>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error(`Backend did not start: ${errors}`)),15000);
  const lines=createInterface({input:child.stdout});
  child.once('error',reject);child.once('exit',()=>{clearTimeout(timeout);reject(new Error(errors));});
  lines.on('line',line=>{const message=JSON.parse(line);if(message.type==='ready'){clearTimeout(timeout);resolve(message);}});
 });
 assert.ok(ready.port>0);
 const response=await fetch(`http://127.0.0.1:${ready.port}/`);assert.equal(response.status,200);
 const session=await (await fetch(`http://127.0.0.1:${ready.port}/api/bootstrap`)).json();
 const headers={'x-studio-token':session.token};
 const projects=await (await fetch(`http://127.0.0.1:${ready.port}/api/projects`,{headers})).json();
 assert.equal(projects.current,null);
 assert.equal((await fetch(`http://127.0.0.1:${ready.port}/api/state`,{headers})).status,409);
 await assert.rejects(fs.access(path.join(directory,'projects')));
 const target=path.join(directory,'My selected project');
 const created=await fetch(`http://127.0.0.1:${ready.port}/api/projects/new`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({path:target})});
 assert.equal(created.status,200,await created.text());
 await fs.access(path.join(target,'.project-studio','project.json'));
 const next=await (await fetch(`http://127.0.0.1:${ready.port}/api/bootstrap`)).json();
 assert.ok(next.projectKey);
 assert.equal((await fetch(`http://127.0.0.1:${ready.port}/api/state`,{headers})).status,409);
 assert.equal((await fetch(`http://127.0.0.1:${ready.port}/api/state`,{headers:{...headers,'x-studio-project':next.projectKey}})).status,200);
 const saved=JSON.parse(await fs.readFile(path.join(directory,'preferences','projects.json'),'utf8'));
 assert.equal(saved.last,await fs.realpath(target));
 child.stdin.write('{"type":"shutdown"}\n');
 assert.equal(await closed,0);
});
