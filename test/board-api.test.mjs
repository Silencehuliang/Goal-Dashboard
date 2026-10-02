/**
 * End-to-end test of the interactive board: boot the real plugin with a mock
 * host context, then drive it the way the browser page does — over the board
 * server's own HTTP API. Nothing here touches the store directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");

async function boot() {
  const { apply } = await import(pathToFileURL(join(repoRoot, "index.js")).href);
  const workspace = mkdtempSync(join(tmpdir(), "goal-dashboard-e2e-"));
  const registered = [];
  const ctx = {
    get: (name) => (name === "sandboxPolicy" ? { workspaceRoot: workspace } : undefined),
    effect: (fn) => fn(),
    tools: {
      register: (def) => { registered.push(def); return () => {}; },
      get: () => ({}),
    },
  };
  const dispose = apply(ctx, { boardPort: 0 });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const help = registered.find((d) => d.name === "board_help");
  const { board_page: url } = await help.execute({}, {});
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/, "board_help must publish the loopback URL");

  const api = async (cmd, payload) => {
    const res = await fetch(`${url}api/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd, payload }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? String(res.status));
    return body;
  };
  const state = async () => (await fetch(`${url}api/state`)).json();

  return { url, api, state, registered, dispose };
}

test("the board page drives a full goal lifecycle over its own API", async () => {
  const { url, api, state, dispose } = await boot();
  try {
    // Start from an empty board served as HTML.
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Goal Dashboard/);
    assert.deepEqual((await state()).total, 0);

    // 1. create a goal from the page
    const created = await api("createGoal", { title: "发布 v1", type: "feature" });
    assert.equal(typeof created.goal, "string");
    let snap = await state();
    assert.equal(snap.total, 1);
    assert.equal(snap.byStatus.draft.length, 1);
    assert.equal(snap.byStatus.draft[0].title, "发布 v1");

    // 2. register criteria
    await api("setCriteria", { goal: created.goal, criteria: ["测试通过", "文档更新"] });
    snap = await state();
    assert.deepEqual(snap.byStatus.draft[0].criteria.map((c) => c.text), ["测试通过", "文档更新"]);
    assert.equal(snap.byStatus.draft[0].criteriaVerified, false);

    // 3. the criteria gate is enforced through the API too: a goal with no
    //    criteria may not enter in_progress, while one that has criteria may.
    await api("transition", { goal: created.goal, to: "planning" });
    const bare = await api("createGoal", { title: "无判据目标" });
    await api("transition", { goal: bare.goal, to: "planning" });
    await assert.rejects(
      () => api("transition", { goal: bare.goal, to: "in_progress" }),
      /判据先于执行/,
    );

    // 4. verify one criterion from the card, then move on
    await api("markCriterion", { goal: created.goal, criterion: "测试通过", verified: true });
    snap = await state();
    const card = () => snap.byStatus.planning.find((g) => g.id === created.goal);
    assert.deepEqual(card().criteria.map((c) => c.verified), [true, false]);
    assert.equal(card().unverified, 1);

    await api("transition", { goal: created.goal, to: "in_progress" });
    snap = await state();
    assert.equal(snap.byStatus.in_progress.length, 1);

    // 5. a blocked move must carry a reason
    await assert.rejects(
      () => api("transition", { goal: created.goal, to: "blocked" }),
      /必须.*原因/,
    );
    await api("transition", { goal: created.goal, to: "blocked", reason: "等上游" });
    snap = await state();
    assert.equal(snap.byStatus.blocked[0].blockReason, "等上游");
    await api("transition", { goal: created.goal, to: "in_progress" });

    // 6. workflow: start a preset, advance a stage
    await api("workflowStart", { goal: created.goal, preset: "bugfix" });
    snap = await state();
    assert.equal(snap.byStatus.in_progress[0].workflow.presetId, "bugfix");
    assert.equal(snap.byStatus.in_progress[0].workflow.stageIndex, 0);
    await api("workflowAdvance", { goal: created.goal });
    snap = await state();
    assert.equal(snap.byStatus.in_progress[0].workflow.stageIndex, 1);

    // 7. notes and archiving
    await api("note", { goal: created.goal, text: "第一次决策" });
    snap = await state();
    assert.equal(snap.byStatus.in_progress[0].notes, 1);
    await api("archive", { goal: created.goal, archived: true });
    await api("archive", { goal: bare.goal, archived: true });
    snap = await state();
    assert.equal(snap.total, 0, "archived goals leave the board");
    assert.equal(snap.archivedCount, 2);

    // 8. every mutation was recorded in the append-only log
    assert.ok((await state()).events >= 8);
  } finally {
    dispose?.();
  }
});

test("the API reports problems instead of failing silently", async () => {
  const { api, dispose } = await boot();
  try {
    await assert.rejects(() => api("createGoal", { title: "   " }), /标题不能为空/);
    await assert.rejects(() => api("nonsenseCommand", {}), /未知命令/);
    await assert.rejects(() => api("transition", { goal: "ghost", to: "planning" }), /目标不存在/);
    await assert.rejects(() => api("workflowStart", { goal: "ghost", preset: "bugfix" }), /目标不存在/);
  } finally {
    dispose?.();
  }
});

test("the state payload carries what the page needs to render", async () => {
  const { state, dispose } = await boot();
  try {
    const snap = await state();
    assert.equal(snap.columns.length, 8, "eight lifecycle columns");
    assert.equal(snap.transitions.draft.includes("planning"), true);
    assert.ok(snap.presets.length >= 5);
    assert.ok(snap.presets.every((p) => p.id && p.title && Array.isArray(p.stages)));
    assert.equal(typeof snap.root, "string");
  } finally {
    dispose?.();
  }
});
