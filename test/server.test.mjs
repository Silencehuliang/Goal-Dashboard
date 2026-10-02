import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

import { DEFAULT_BOARD_PORT, startBoardServer } from "../lib/server.js";

/** fetch() refuses to set Host (it is a forbidden header), so go raw here. */
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: "GET", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Minimal stand-in for the plugin's snapshot/command wiring. */
const deps = () => {
  const seen = [];
  return {
    seen,
    snapshot: (workspace) => ({ workspace, total: 0, byStatus: {}, columns: [], transitions: {}, presets: [] }),
    command: (cmd, payload, workspace) => {
      seen.push({ cmd, payload, workspace });
      if (cmd === "boom") throw new Error("store said no");
      return { ok: true, cmd };
    },
  };
};

const start = (over = {}) => startBoardServer({ port: 0, ...deps(), ...over });

test("serves the shell with its assets", async () => {
  const server = await start();
  const res = await fetch(server.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const body = await res.text();
  assert.match(body, /Goal Dashboard/);
  assert.match(body, /\/app\.css/);
  assert.match(body, /\/app\.js/);

  assert.equal((await fetch(`${server.url}app.css`)).headers.get("content-type").startsWith("text/css"), true);
  assert.equal((await fetch(`${server.url}app.js`)).headers.get("content-type").startsWith("text/javascript"), true);
  await server.close();
});

test("allows framing but forbids inline script", async () => {
  const server = await start();
  const csp = (await fetch(server.url)).headers.get("content-security-policy");
  assert.match(csp, /frame-ancestors \*/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  await server.close();
});

test("exposes the board path too, and 404s anything else", async () => {
  const server = await start();
  assert.equal((await fetch(`${server.url}goal-dashboard`)).status, 200);
  assert.equal((await fetch(`${server.url}nope`)).status, 404);
  await server.close();
});

test("GET /api/state returns the snapshot for the requested workspace", async () => {
  const server = await start();
  const data = await (await fetch(`${server.url}api/state?workspace=${encodeURIComponent("C:/work/x")}`)).json();
  assert.equal(data.workspace, "C:/work/x");
  assert.equal(data.total, 0);
  await server.close();
});

test("POST /api/command dispatches to the command handler", async () => {
  const d = deps();
  const server = await startBoardServer({ port: 0, ...d });
  const res = await fetch(`${server.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "createGoal", payload: { title: "hi" } }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cmd: "createGoal" });
  assert.deepEqual(d.seen[0], { cmd: "createGoal", payload: { title: "hi" }, workspace: null });
  await server.close();
});

test("a failing command becomes a readable 400, not a crashed server", async () => {
  const server = await start();
  const res = await fetch(`${server.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "boom" }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /store said no/);
  assert.equal((await fetch(server.url)).status, 200, "server must still be usable");
  await server.close();
});

test("rejects a command without a JSON content type (this is the CSRF defence)", async () => {
  const server = await start();
  const res = await fetch(`${server.url}api/command`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ cmd: "createGoal" }),
  });
  assert.equal(res.status, 415);
  await server.close();
});

test("rejects malformed JSON and a missing cmd", async () => {
  const server = await start();
  const bad = await fetch(`${server.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(bad.status, 400);

  const empty = await fetch(`${server.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(empty.status, 400);
  await server.close();
});

test("rejects a non-loopback Host header (DNS-rebinding guard)", async () => {
  const server = await start();
  assert.equal((await rawGet(server.url, { host: "evil.example.com" })).status, 403);
  assert.equal((await rawGet(server.url, { host: "127.0.0.1" })).status, 200);
  await server.close();
});

test("rejects a non-loopback Origin", async () => {
  const server = await start();
  const res = await fetch(server.url, { headers: { origin: "https://evil.example.com" } });
  assert.equal(res.status, 403);
  await server.close();
});

test("accepts the host app's own origin, because the page runs inside it", async () => {
  const server = await start();
  assert.equal((await fetch(server.url, { headers: { origin: "dsh-app://app" } })).status, 200);
  await server.close();
});

test("rejects a POST to a read route", async () => {
  const server = await start();
  assert.equal((await fetch(server.url, { method: "POST" })).status, 404);
  await server.close();
});

test("exposes a default port constant above the privileged range", () => {
  assert.ok(Number.isInteger(DEFAULT_BOARD_PORT) && DEFAULT_BOARD_PORT > 1024);
});

test("port false or null disables the server", async () => {
  for (const port of [false, null]) {
    const handle = await startBoardServer({ port, ...deps() });
    assert.equal(handle.ok, false);
    assert.equal(handle.disabled, true);
    await handle.close();
  }
});

test("a taken preferred port falls back to an ephemeral port", async () => {
  const first = await start();
  const second = await startBoardServer({ port: first.port, ...deps() });
  assert.equal(second.ok, true);
  assert.notEqual(second.port, first.port);
  assert.equal((await fetch(second.url)).status, 200);
  await second.close();
  await first.close();
});

test("an unusable port value falls back to the default", async () => {
  const handle = await startBoardServer({ port: -5, ...deps() });
  assert.equal(handle.ok, true);
  await handle.close();
});
