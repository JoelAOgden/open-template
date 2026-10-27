import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request } from "node:http";
import { Store } from "../server/store.js";
import { Studio } from "../server/studio.js";
import { createHttpServer } from "../server/http.js";

async function setup(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-http-"));
  const studio = new Studio(new Store(root));
  await studio.init();
  const server = createHttpServer(studio, process.cwd());
  const port = await server.listen(0),
    base = `http://127.0.0.1:${port}`;
  const { token } = (await (await fetch(`${base}/api/bootstrap`)).json()) as {
    token: string;
  };
  const headers = {
    "X-Studio-Token": token,
    "Content-Type": "application/json",
  };
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { studio, base, port, headers };
}
test("HTTP enforces Origin, Host, session tokens, mutation format and private-file denial", async (t) => {
  const { base, headers, port } = await setup(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 403);
  assert.equal((await fetch(`${base}/api/prompts`)).status, 403);
  assert.equal((await fetch(`${base}/api/debug/files`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/debug/file?path=AGENTS.md`)).status,
    403,
  );
  const instructions = await fetch(`${base}/api/debug/file?path=AGENTS.md`, {
    headers,
  });
  assert.equal(instructions.status, 200);
  assert.match(
    (await instructions.json()).text,
    /previous pipeline has been removed/,
  );
  assert.equal(
    (await fetch(`${base}/api/debug/files?scope=host`, { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/debug/file?path=..%2Fstate.json`, { headers }))
      .status,
    404,
  );
  assert.equal((await fetch(`${base}/api/prompts/123`)).status, 403);
  assert.equal((await fetch(`${base}/api/runs`)).status, 403);
  assert.equal((await fetch(`${base}/api/runs/123`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/runs/%2e%2e%2fproject`, { headers })).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/runs/00000000-0000-4000-8000-000000000000`, {
        headers,
      })
    ).status,
    404,
  );
  assert.deepEqual(
    await (await fetch(`${base}/api/runs`, { headers })).json(),
    [],
  );
  assert.equal(
    (await fetch(`${base}/api/prompts/%2e%2e%2fproject`, { headers })).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/prompts/00000000-0000-4000-8000-000000000000`, {
        headers,
      })
    ).status,
    404,
  );
  assert.equal((await fetch(`${base}/api/state`, { headers })).status, 200);
  for (const origin of [
    "https://evil.example",
    "null",
    "http://localhost:9999",
    "http://127.0.0.1.evil.com",
  ])
    assert.equal(
      (await fetch(`${base}/api/bootstrap`, { headers: { Origin: origin } }))
        .status,
      403,
    );
  assert.equal(
    (
      await fetch(`${base}/api/bootstrap`, {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  const hostStatus = await new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/bootstrap",
        headers: { Host: `attacker.example:${port}` },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal(
    (
      await fetch(`${base}/api/sections`, {
        method: "POST",
        headers: {
          "X-Studio-Token": headers["X-Studio-Token"],
          "Content-Type": "text/plain",
        },
        body: '{"name":"Unsafe"}',
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(`${base}/api/sections`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Features" }),
      })
    ).status,
    409,
  );
  for (const file of [
    "../.project-ide/project.json",
    "/etc/passwd",
    ".env",
    "a\\b",
  ])
    assert.equal(
      (
        await fetch(`${base}/api/file?path=${encodeURIComponent(file)}`, {
          headers,
        })
      ).status,
      400,
    );
  for (const p of [
    "/.project-ide/project.json",
    "/.project-ide/prompts/index.json",
    "/server/index.ts",
    "/project_src/package.json",
    "/@fs/etc/passwd",
  ])
    assert.equal((await fetch(`${base}${p}`)).status, 404);
  for (const route of ["/import", "/discard"])
    assert.equal(
      (
        await fetch(`${base}/api${route}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ paths: ["package.json"] }),
        })
      ).status,
      404,
    );
  assert.equal(
    (
      await fetch(`${base}/api/shell`, {
        method: "POST",
        headers,
        body: '{"command":"echo hello"}',
      })
    ).status,
    404,
  );
});

test("HTTP deletion validates versions, requires local authorization and removes only requested definitions", async (t) => {
  const { studio, base, headers } = await setup(t);
  const section = await studio.store.addSection("Research");
  const doc = studio.store.project.documents.find(d => d.sectionId === section.id)!;
  const remove = (
    route: string,
    value: unknown,
    requestHeaders: Record<string, string> = headers,
  ) =>
    fetch(`${base}/api${route}`, {
      method: "DELETE",
      headers: requestHeaders,
      body: JSON.stringify(value),
    });
  assert.equal(
    (
      await remove(
        `/documents/${doc.id}`,
        { version: 0 },
        {
          "Content-Type": "application/json",
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await remove(
        `/documents/${doc.id}`,
        { version: 0 },
        { ...headers, Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal((await remove(`/documents/${doc.id}`, {})).status, 400);
  assert.equal(
    (await remove(`/documents/${doc.id}`, { version: -1 })).status,
    400,
  );
  assert.equal(
    (await remove(`/documents/${doc.id}`, { version: 1 })).status,
    409,
  );
  assert.equal(
    (await remove("/documents/%2e%2e%2fproject", { version: 0 })).status,
    400,
  );
  assert.equal(
    (await remove(`/sections/${section.id}`, { documents: [] })).status,
    409,
  );
  assert.equal(
    (
      await remove(`/sections/${section.id}`, {
        documents: [
          { id: doc.id, version: 0 },
          { id: doc.id, version: 0 },
        ],
      })
    ).status,
    409,
  );
  for (const locked of studio.store.project.sections.filter(s => s.id !== section.id)) {
    const result = await remove(`/sections/${locked.id}`, {
      documents: studio.store.project.documents.filter(d => d.sectionId === locked.id).map(({id,version})=>({id,version})),
    });
    assert.equal(result.status, 409);
    assert.match(await result.text(), /Default sections cannot be deleted/);
  }
  assert.equal((await remove("/plan", {})).status, 404);
  const response = await remove(`/documents/${doc.id}`, { version: 0 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).documents.length, 4);
  assert.equal(
    (await remove(`/documents/${doc.id}`, { version: 0 })).status,
    404,
  );
  assert.equal(
    (await remove(`/sections/${section.id}`, { documents: [] })).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/skills/${section.slug}`, { headers })).status,
    404,
  );
  assert.equal(studio.store.project.sections.length, 4);
  assert.equal(studio.session, null);
  assert.equal(studio.store.state.appliedSnapshotHash, null);
});