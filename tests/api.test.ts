import test from "node:test";
import assert from "node:assert/strict";

let clientId = 0;
async function client(
  t: test.TestContext,
  fetch: (url: string, options?: RequestInit) => Promise<Response>,
) {
  t.mock.method(globalThis, "fetch", fetch);
  return import(`../src/lib/api.ts?test=${clientId++}`) as Promise<
    typeof import("../src/lib/api.js")
  >;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const expired = () =>
  json(
    { error: "Missing or invalid local session token. Reload open-template." },
    403,
  );

test("API explains unavailable routes while preserving missing-document errors", async (t) => {
  let requests = 0;
  const { api } = await client(t, async (url) => {
    if (url === "/api/bootstrap") return json({ token: "session" });
    requests++;
    return json(
      { error: url === "/api/document" ? "Document not found." : url.slice(5) },
      404,
    );
  });
  for (const error of ["API route not found.", "Endpoint not found."])
    await assert.rejects(api(`/${error}`, {}, "DELETE"), /Restart open-template/);
  await assert.rejects(api("/document", {}, "DELETE"), /Document not found\./);
  assert.equal(requests, 3);
});

test("API renews one shared session after restart for reads, writes and assets", async (t) => {
  let currentToken = "before",
    bootstraps = 0,
    rejected = 0,
    deletes = 0;
  const payload = { version: 4 };
  const { api, assetUrl } = await client(t, async (url, options) => {
    if (url === "/api/bootstrap") {
      bootstraps++;
      return json({ token: currentToken });
    }
    if (new Headers(options?.headers).get("X-Studio-Token") !== currentToken) {
      rejected++;
      return expired();
    }
    if (options?.method === "DELETE") {
      deletes++;
      assert.equal(options.body, JSON.stringify(payload));
      assert.equal(
        new Headers(options.headers).get("Content-Type"),
        "application/json",
      );
    }
    if (url.startsWith("/api/assets/")) return new Response("image bytes");
    return json({ ok: true });
  });
  await api("/state");
  currentToken = "after";
  const [deleted, state, asset] = await Promise.all([
    api("/documents/id", payload, "DELETE"),
    api("/state"),
    assetUrl("image.png"),
  ]);
  assert.deepEqual(deleted, { ok: true });
  assert.deepEqual(state, { ok: true });
  assert.match(asset, /^blob:/);
  URL.revokeObjectURL(asset);
  assert.equal(bootstraps, 2);
  assert.equal(rejected, 3);
  assert.equal(deletes, 1);
});

test("API never replays ambiguous failures or other authorization errors", async (t) => {
  let bootstraps = 0,
    requests = 0;
  const { api } = await client(t, async (url) => {
    if (url === "/api/bootstrap") {
      bootstraps++;
      return json({ token: "session" });
    }
    requests++;
    if (url === "/api/network") throw new TypeError("Failed to fetch");
    if (url === "/api/origin") return json({ error: "Untrusted Origin." }, 403);
    return json({ error: "Local operation failed." }, 500);
  });
  await assert.rejects(api("/network", {}), /Failed to fetch/);
  await assert.rejects(api("/origin", {}), /Untrusted Origin/);
  await assert.rejects(api("/failure", {}), /Local operation failed/);
  assert.equal(bootstraps, 1);
  assert.equal(requests, 3);
});

test("API retries session rejection only once and recovers a failed bootstrap", async (t) => {
  let bootstraps = 0,
    requests = 0;
  const { api } = await client(t, async (url) => {
    if (url === "/api/bootstrap") {
      bootstraps++;
      if (bootstraps === 1) return json({}, 503);
      return json({ token: "session" });
    }
    requests++;
    return expired();
  });
  await assert.rejects(api("/state"), /Cannot connect/);
  await assert.rejects(api("/state"), /Missing or invalid local session token/);
  assert.equal(bootstraps, 3);
  assert.equal(requests, 2);
});

test("API refuses to replay a write into a different project after a restart", async t=>{
 let projectKey='a',writes=0;
 const {api}=await client(t,async(url,options)=>{
  if(url==='/api/bootstrap')return json({token:projectKey,projectKey});
  if(new Headers(options?.headers).get('X-Studio-Token')!==projectKey)return expired();
  assert.equal(new Headers(options?.headers).get('X-Studio-Project'),projectKey);
  if(options?.method==='POST')writes++;
  return json({});
 });
 await api('/state');projectKey='b';
 await assert.rejects(api('/project',{name:'Wrong project'}),/Project changed/);
 await assert.rejects(api('/project',{name:'Still wrong'}),/Project changed/);
 assert.equal(writes,0);
});
