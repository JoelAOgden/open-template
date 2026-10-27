import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Studio } from "../server/studio.js";
import { Store } from "../server/store.js";
import { ServiceSetup } from "../server/service-setup.js";
import { createHttpServer } from "../server/http.js";
import type { Provider } from "../shared/agent-settings.js";
import type { ServiceSetupAction, ServiceStatus } from "../shared/service-setup.js";

test("service setup is token protected and accepts only supported provider/action pairs",async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"studio-service-http-"));
 const studio=new Studio(new Store(root));await studio.init();
 const calls:string[]=[];
 class FakeSetup extends ServiceSetup {
  async status(provider:Provider):Promise<ServiceStatus>{return {provider,installed:false,auth:"unknown",message:"Missing"};}
  async launch(provider:Provider,action:ServiceSetupAction){calls.push(`${provider}:${action}`);return {message:"Opened"};}
 }
 const app=createHttpServer(studio,root,{services:new FakeSetup(root)});
 let port:number;
 try{port=await app.listen(0);}catch(error){await studio.close();await fs.rm(root,{recursive:true,force:true});if((error as NodeJS.ErrnoException).code==='EPERM'){t.skip('Loopback listen is unavailable');return;}throw error;}
 t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 const {token}=await (await fetch(`${base}/api/bootstrap`)).json();
 const headers={'X-Studio-Token':token,'Content-Type':'application/json'};
 const post=(value:unknown,h:Record<string,string>=headers)=>fetch(`${base}/api/services/setup`,{method:'POST',headers:h,body:JSON.stringify(value)});
 assert.equal((await post({provider:'gemini',action:'login'},{'Content-Type':'application/json'})).status,403);
 assert.equal((await post({provider:'gemini',action:'login',command:'touch evil'})).status,400);
 assert.equal((await post({provider:'other',action:'login'})).status,400);
 assert.equal((await post({provider:'gemini',action:'shell'})).status,400);
 assert.equal((await post({provider:'gemini',action:'install'})).status,400);
 assert.deepEqual(calls,[]);
 assert.equal((await post({provider:'gemini',action:'login'})).status,200);
 assert.deepEqual(calls,['gemini:login']);
 const status=await fetch(`${base}/api/services/status?provider=claude`,{headers});assert.equal(status.status,200);
 assert.equal((await status.json()).provider,'claude');
 assert.equal((await fetch(`${base}/api/services/status?provider=other`,{headers})).status,400);
});
