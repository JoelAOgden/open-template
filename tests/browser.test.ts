import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSession, localPage, startBrowserBridge } from "../server/browser.js";
import type { Browser, Page, Route } from "playwright";

function fixture() {
  let launches = 0, closes = 0;
  const actions: unknown[] = [];
  let route!: (r: Route) => Promise<void>;
  const page = { isClosed: () => false, url: () => "http://127.0.0.1:3000/", setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    goto: async (url: string) => { actions.push(url); }, screenshot: async () => Buffer.from("png"),
    locator: (selector: string) => ({ ariaSnapshot: async () => "- button Save", click: async () => { actions.push(selector); }, fill: async (value: string) => { actions.push(value); }, press: async () => {} }),
    evaluate: async (expression: string) => expression, setViewportSize: async (size: unknown) => { actions.push(size); },
  } as unknown as Page;
  const browser = { close: async () => { closes++; }, newContext: async (options: unknown) => { actions.push(options); return {
    route: async (_: string, fn: typeof route) => { route = fn; }, newPage: async () => page, on() {},
  }; } } as unknown as Browser;
  const controller = new AbortController();
  const session = new BrowserSession(controller.signal, () => {}, async () => { launches++; return browser; });
  return { session, controller, actions, launches: () => launches, closes: () => closes, route: () => route };
}
test("managed browser launches lazily, reuses one page, and returns screenshot bytes without host paths", async () => {
  const f = fixture(); assert.equal(f.launches(), 0);
  await f.session.perform({action:"goto",url:"http://localhost:3000"});
  assert.deepEqual(await f.session.perform({action:"snapshot"}),{url:"http://127.0.0.1:3000/",text:"- button Save"});
  assert.deepEqual(await f.session.perform({action:"screenshot"}),{image:Buffer.from("png").toString("base64")});
  await f.session.perform({action:"click",selector:"button"});
  assert.equal(f.launches(),1);
  assert.deepEqual(f.actions[0],{acceptDownloads:false,serviceWorkers:"block",viewport:{width:1440,height:900}});
  await assert.rejects(f.session.perform({action:"screenshot",path:"/tmp/host-file"}));
  await f.session.close(); assert.ok(f.closes()>0);
  await assert.rejects(f.session.perform({action:"snapshot"}),/ended/);
});
test("browser rejects nonlocal navigation, arbitrary commands and file requests", async () => {
  const f = fixture();
  for(const url of ["file:///etc/passwd","https://example.com","http://localhost.evil.test","http://user:pass@localhost","javascript:alert(1)"]){
    assert.equal(localPage(url),false);
    await assert.rejects(f.session.perform({action:"goto",url}));
  }
  assert.equal(f.launches(),0);
  await assert.rejects(f.session.perform({action:"exec",command:"touch /tmp/bad"}));
  await f.session.perform({action:"goto",url:"http://127.0.0.1:3000"});
  for(const [url,navigation,allowed] of [["file:///etc/passwd",false,false],["https://example.com",true,false],["https://cdn.example.com/style.css",false,true],["http://localhost:3000",true,true]] as const){
    let outcome = "";
    await f.route()({request:()=>({url:()=>url,isNavigationRequest:()=>navigation}),abort:async()=>{outcome="blocked";},continue:async()=>{outcome="allowed";}} as unknown as Route);
    assert.equal(outcome,allowed?"allowed":"blocked");
  }
  await f.session.close();
});
test("stopping during browser launch closes the late browser", async () => {
  let finish!: (browser: Browser) => void, closes = 0;
  const session = new BrowserSession(new AbortController().signal,()=>{},()=>new Promise(resolve=>{finish=resolve;}));
  const pending = session.perform({action:"snapshot"});
  const rejected = assert.rejects(pending,/ended/);
  const closing = session.close();
  finish({close:async()=>{closes++;}} as unknown as Browser);
  await closing;await rejected;assert.equal(closes,1);
});
test("browser bridge rejects missing tokens, foreign origins and methods before launching", async t => {
  const controller = new AbortController();
  let bridge: Awaited<ReturnType<typeof startBrowserBridge>>;
  try { bridge = await startBrowserBridge(controller.signal,()=>{}); }
  catch(error) { if((error as NodeJS.ErrnoException).code==="EPERM"){t.skip("Loopback binding is unavailable in this sandbox");return;} throw error; }
  t.after(()=>bridge.close());
  const url=bridge.env.STUDIO_BROWSER_URL,headers={Authorization:`Bearer ${bridge.env.STUDIO_BROWSER_TOKEN}`};
  assert.equal((await fetch(url,{method:"POST",body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:"POST",headers:{...headers,Origin:"http://evil.test"},body:'{}'})).status,403);
  assert.equal((await fetch(url,{headers})).status,404);
  const invalid=await fetch(url,{method:"POST",headers,body:JSON.stringify({action:"goto",url:"file:///etc/passwd"})});
  assert.equal(invalid.status,400);
  controller.abort();await bridge.close();
});
