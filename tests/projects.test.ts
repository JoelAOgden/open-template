import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../server/projects.js';
import { Store, paragraph } from '../server/store.js';
import { Studio } from '../server/studio.js';
import { atomicWrite } from '../server/files.js';
import type { CodingAgent } from '../server/codex-cli.js';
const agent:CodingAgent={async status(){return {available:true};},async run(call){if(call.writable)await atomicWrite(call.cwd,'result.txt','implemented');return {status:'completed',summary:'Done',requirements:[],findings:[]};}};
async function fixture(t:test.TestContext){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'studio-folders-')));const app=path.join(base,'app');await fs.mkdir(app);
 const projects=new Projects(app);await projects.init();
 const studio=new Studio(new Store(path.join(base,"fixture"),"folder"),agent);await studio.init();await projects.opened(studio.store);
 t.after(async()=>{await studio.close();await fs.rm(base,{recursive:true,force:true});});return {base,app,projects,studio};
}
test('folder projects isolate definitions, saved runs and code; accepting preserves managed files',async t=>{
 const {base,projects,studio}=await fixture(t);const a=path.join(base,'a'),b=path.join(base,'b');await fs.mkdir(a);await fs.writeFile(path.join(a,'AGENTS.md'),'Existing instructions\n');await fs.writeFile(path.join(a,'existing.txt'),'original');
 await projects.open(studio,a);const firstKey=studio.workspaceKey;
 const doc=studio.store.project.documents[0];await studio.store.saveDocument(doc.id,{...doc,nodes:[paragraph('Build a useful application')]});
 const instructions=await fs.readFile(path.join(a,'AGENTS.md'),'utf8');assert.match(instructions,/Existing instructions/);assert.match(instructions,/project-studio:begin/);
 assert.deepEqual(Object.keys(await studio.store.projectManifest()),['existing.txt','start.sh']);
 const run=await studio.workflows.create({acceptancePolicy:"manual",fullSpec:false,source:'project'});await studio.workflows.waitForIdle();assert.equal(studio.workflows.active!.status,'review',studio.workflows.active!.error);
 await projects.open(studio,b);assert.notEqual(studio.workspaceKey,firstKey);assert.equal(studio.workflows.active,null);assert.notEqual(studio.store.project.documents[0].id,doc.id);
 await projects.open(studio,a);assert.equal(studio.workflows.active!.id,run.id);assert.equal(studio.store.project.documents[0].id,doc.id);
 await studio.workflows.accept(run.id);assert.equal(await fs.readFile(path.join(a,'result.txt'),'utf8'),'implemented');assert.equal(await fs.readFile(path.join(a,'AGENTS.md'),'utf8'),instructions);assert.ok(await fs.stat(path.join(a,'.project-studio/project.json')));
 const restarted=new Projects(projects.appRoot);await restarted.init();assert.equal((await restarted.initialStore())?.root,a);
});
test('folder validation rejects application, ancestors, metadata, symlinks and nested projects',async t=>{
 const {base,app,projects,studio}=await fixture(t);const a=path.join(base,'a');await projects.open(studio,a);
 for(const candidate of [app,base,path.join(a,'child'),path.join(a,'.project-studio'),path.join(app,'server')])await assert.rejects(projects.validate(candidate));
 await fs.symlink(a,path.join(base,'alias'));await assert.rejects(projects.validate(path.join(base,'alias')),/symbolic/);
 assert.equal(studio.store.root,a);
});
test('startup never creates a default project or migrates legacy data',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'studio-startup-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const manager=new Projects(base);await manager.init();assert.equal(await manager.initialStore(),null);
 const legacy=new Store(base);await legacy.init();
 const before=await fs.readFile(path.join(legacy.dataDir,'project.json'));
 assert.equal(await manager.initialStore(),null);
 await assert.rejects(fs.access(path.join(base,'projects')));
 assert.deepEqual(await fs.readFile(path.join(legacy.dataDir,'project.json')),before);
});
test('missing last folder returns to setup without replacing it',async t=>{
 const {app,studio}=await fixture(t);
 await studio.close();await fs.rm(studio.store.root,{recursive:true});
 const restarted=new Projects(app);await restarted.init();assert.equal(await restarted.initialStore(),null);
 assert.match(restarted.notice!,/could not be reopened/);
 await assert.rejects(fs.access(path.join(app,'projects')));
});

test('project HTTP switch rejects stale reads/writes and switching during a run',async t=>{
 const {base,projects,studio}=await fixture(t);
 const {createHttpServer}=await import('../server/http.js');const {Readable,Writable}=await import('node:stream');
 const app=createHttpServer(studio,projects.appRoot,{projects});
 const dispatch=async(route:string,session?:{token:string;projectKey:string},payload?:unknown)=>{
  const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  Object.assign(req,{url:'/api'+route,method:payload===undefined?'GET':'POST',headers:{host:'127.0.0.1:4310','content-type':'application/json',...(session?{'x-studio-token':session.token,'x-studio-project':session.projectKey}:{})}});
  let status=200,content='';const res=new Writable({write(chunk,_encoding,callback){content+=chunk;callback();}});Object.assign(res,{setHeader(){},writeHead(code:number){status=code;}});
  await new Promise<void>((resolve,reject)=>{res.on('finish',resolve);res.on('error',reject);app.server.emit('request',req,res);});return {status,body:JSON.parse(content)};
 };
 const session=(await dispatch('/bootstrap')).body;
 studio.workflows.busy=true;assert.equal((await dispatch('/projects/open',session,{path:path.join(base,'b')})).status,409);studio.workflows.busy=false;
 assert.equal((await dispatch('/projects/open',session,{path:path.join(base,'b')})).status,200);
 assert.equal((await dispatch('/project',session,{name:'Wrong project'})).status,409);
 assert.equal((await dispatch('/state',session)).status,409);assert.equal(studio.store.project.name,'b');
 const next=(await dispatch('/bootstrap')).body;assert.equal((await dispatch('/state',next)).status,200);
});

test('creating a project creates a distinct folder and refuses an existing destination',async t=>{
 const {base,projects,studio}=await fixture(t);const target=path.join(base,'New project');
 await projects.open(studio,target,true);
 assert.equal(studio.store.project.name,'New project');
 assert.equal(studio.store.project.sections.length,4);
 const key=studio.workspaceKey;
 const before=await fs.readFile(path.join(target,'.project-studio/project.json'));
 await assert.rejects(projects.open(studio,target,true),/already exists/);
 assert.equal(studio.workspaceKey,key);
 assert.deepEqual(await fs.readFile(path.join(target,'.project-studio/project.json')),before);
});
