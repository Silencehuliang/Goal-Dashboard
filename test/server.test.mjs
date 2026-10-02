import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_BOARD_PORT, startBoardServer } from "../lib/server.js";

const html = (workspace) => `<!doctype html><title>board</title><p>ws=${workspace ?? "none"}</p>`;

test("serves the board on a loopback port and shuts down cleanly", async () => {
  const server = await startBoardServer({ port: 0, render: html });
  assert.equal(server.ok, true, server.error?.message);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const res = await fetch(server.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /board/);

  await server.close();
});

test("exposes a default port constant for the host config", () => {
  assert.equal(Number.isInteger(DEFAULT_BOARD_PORT), true);
  assert.ok(DEFAULT_BOARD_PORT > 1024, "must not need privileges");
});

test("accepts the board path and reports an unknown route as 404", async () => {
  const server = await startBoardServer({ port: 0, render: html });
  assert.equal((await fetch(`${server.url}goal-dashboard`)).status, 200);
  assert.equal((await fetch(`${server.url}nope`)).status, 404);
  await server.close();
});

test("passes the workspace query through to the renderer", async () => {
  const server = await startBoardServer({ port: 0, render: html });
  const body = await (await fetch(`${server.url}?workspace=${encodeURIComponent("C:/work/x")}`)).text();
  assert.match(body, /ws=C:\/work\/x/);
  await server.close();
});

test("rejects non-GET methods", async () => {
  const server = await startBoardServer({ port: 0, render: html });
  assert.equal((await fetch(server.url, { method: "POST" })).status, 405);
  await server.close();
});

test("explicitly allows framing, because being embedded by the host is the point", async () => {
  const server = await startBoardServer({ port: 0, render: html });
  const res = await fetch(server.url);
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors \*/);
  await server.close();
});

test("a render error becomes a readable 400, not a crash", async () => {
  const server = await startBoardServer({
    port: 0,
    render: () => { throw new Error("no workspace"); },
  });
  const res = await fetch(server.url);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /no workspace/);
  await server.close();
});

test("port false or null disables the server", async () => {
  for (const port of [false, null]) {
    const handle = await startBoardServer({ port, render: html });
    assert.equal(handle.ok, false);
    assert.equal(handle.disabled, true);
    assert.equal(typeof handle.close, "function");
    await handle.close();
  }
});

test("a taken preferred port falls back to an ephemeral port instead of failing", async () => {
  const first = await startBoardServer({ port: 0, render: html });
  const second = await startBoardServer({ port: first.port, render: html });
  assert.equal(second.ok, true, "must not fail just because the preferred port is busy");
  assert.notEqual(second.port, first.port);
  assert.equal((await fetch(second.url)).status, 200);
  await second.close();
  await first.close();
});

test("an unusable port value falls back to the default rather than throwing", async () => {
  const handle = await startBoardServer({ port: -5, render: html });
  assert.equal(handle.ok, true);
  await handle.close();
});
