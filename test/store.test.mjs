import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BoardError } from "../lib/model.js";
import {
  addNote, advanceWorkflow, appendEvent, boardSnapshot, createGoal, ensureBoard, listGoals,
  markCriterion, readEvents, readGoal, resolveBoardRoot, setArchived, setCriteria, startWorkflow,
  transitionGoal, validateBoard,
} from "../lib/store.js";

const freshRoot = () => {
  const ws = mkdtempSync(join(tmpdir(), "goal-dashboard-test-"));
  const root = join(ws, ".goal-board");
  ensureBoard(root);
  return root;
};

test("resolveBoardRoot defaults to .goal-board inside the workspace", () => {
  const ws = mkdtempSync(join(tmpdir(), "goal-dashboard-ws-"));
  assert.equal(resolveBoardRoot(ws), join(ws, ".goal-board"));
});

test("resolveBoardRoot honours a relative config root and rejects a missing workspace", () => {
  const ws = mkdtempSync(join(tmpdir(), "goal-dashboard-ws-"));
  assert.equal(resolveBoardRoot(ws, "custom-dir"), join(ws, "custom-dir"));
  assert.throws(() => resolveBoardRoot(null), BoardError);
  assert.throws(() => resolveBoardRoot("   "), BoardError);
});

test("createGoal writes a goal file and appends exactly one event", () => {
  const root = freshRoot();
  const goal = createGoal(root, { title: "发布 v1", type: "feature" }, "agent:test");
  assert.equal(goal.status, "draft");
  assert.ok(existsSync(join(root, "goals", `${goal.id}.json`)));
  const events = readEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "goal.created");
  assert.equal(events[0].actor, "agent:test");
  assert.equal(events[0].goal, goal.id);
});

test("createGoal disambiguates colliding titles", () => {
  const root = freshRoot();
  const a = createGoal(root, { title: "同一标题" }, "t");
  const b = createGoal(root, { title: "同一标题" }, "t");
  assert.notEqual(a.id, b.id);
  assert.equal(b.id, "同一标题-2");
});

test("createGoal rejects an empty title", () => {
  const root = freshRoot();
  assert.throws(() => createGoal(root, { title: "  " }, "t"), BoardError);
});

test("readGoal gives an actionable error for an unknown slug", () => {
  const root = freshRoot();
  createGoal(root, { title: "已存在" }, "t");
  assert.throws(() => readGoal(root, "nope"), /目标不存在.*已存在/s);
});

test("a corrupt goal file is reported, never silently ignored by readGoal", () => {
  const root = freshRoot();
  writeFileSync(join(root, "goals", "broken.json"), "{not json");
  assert.throws(() => readGoal(root, "broken"), /无法解析/);
});

test("listGoals filters by status, type and archived", () => {
  const root = freshRoot();
  const a = createGoal(root, { title: "甲", type: "bug" }, "t");
  const b = createGoal(root, { title: "乙", type: "feature" }, "t");
  setCriteria(root, a.id, ["可复现"], "t");
  transitionGoal(root, a.id, "planning", {}, "t");
  assert.equal(listGoals(root).length, 2);
  assert.deepEqual(listGoals(root, { status: "planning" }).map((g) => g.id), [a.id]);
  assert.deepEqual(listGoals(root, { type: "feature" }).map((g) => g.id), [b.id]);
  setArchived(root, b.id, true, "t");
  assert.equal(listGoals(root).length, 1);
  assert.equal(listGoals(root, { includeArchived: true }).length, 2);
});

test("setCriteria replaces the list and records the event", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "有判据" }, "t");
  const next = setCriteria(root, g.id, ["第一条", "第二条"], "t", { verified: ["第一条"] });
  assert.equal(next.criteria.length, 2);
  assert.deepEqual(readGoal(root, g.id).criteria, [
    { text: "第一条", verified: true },
    { text: "第二条", verified: false },
  ]);
  assert.equal(readEvents(root).at(-1).event, "criteria.set");
});

test("setCriteria rejects an empty list", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "空判据" }, "t");
  assert.throws(() => setCriteria(root, g.id, [], "t"), BoardError);
  assert.throws(() => setCriteria(root, g.id, ["  "], "t"), BoardError);
});

test("markCriterion locates a criterion by unique prefix and rejects ambiguity", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "判据定位" }, "t");
  setCriteria(root, g.id, ["测试通过", "测试覆盖 > 80%"], "t");
  const marked = markCriterion(root, g.id, "测试通过", true, "t");
  assert.equal(marked.criteria[0].verified, true);
  assert.equal(marked.criteria[1].verified, false);
  assert.throws(() => markCriterion(root, g.id, "测试", true, "t"), /不唯一/);
  assert.throws(() => markCriterion(root, g.id, "没有这条", true, "t"), /没有匹配/);
  const undone = markCriterion(root, g.id, "测试通过", false, "t");
  assert.equal(undone.criteria[0].verified, false);
});

test("transitionGoal enforces the criteria gate end to end", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "门禁" }, "t");
  transitionGoal(root, g.id, "planning", {}, "t");
  assert.throws(() => transitionGoal(root, g.id, "in_progress", {}, "t"), /判据先于执行/);
  setCriteria(root, g.id, ["可验收"], "t");
  const running = transitionGoal(root, g.id, "in_progress", {}, "t");
  assert.equal(running.status, "in_progress");
});

test("transitionGoal records from/to and supports blocking then unblocking", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "阻塞" }, "t");
  transitionGoal(root, g.id, "planning", {}, "t");
  transitionGoal(root, g.id, "blocked", { reason: "依赖未就绪" }, "t");
  const blocked = readGoal(root, g.id);
  assert.equal(blocked.blockedFrom, "planning");
  transitionGoal(root, g.id, "planning", {}, "t");
  assert.equal(readGoal(root, g.id).status, "planning");
  const transitions = readEvents(root).filter((e) => e.event === "goal.transitioned");
  assert.equal(transitions.length, 3);
  assert.equal(transitions[1].details.to, "blocked");
  assert.equal(transitions[1].details.reason, "依赖未就绪");
});

test("addNote appends to history and to the event log", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "备注" }, "t");
  addNote(root, g.id, "第一次决策", "t");
  addNote(root, g.id, "第二次决策", "t");
  assert.deepEqual(readGoal(root, g.id).notes.map((n) => n.text), ["第一次决策", "第二次决策"]);
  assert.equal(readEvents(root).filter((e) => e.event === "goal.noted").length, 2);
  assert.throws(() => addNote(root, g.id, "  ", "t"), BoardError);
});

test("the event log is append-only: earlier lines never change", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "追加" }, "t");
  appendEvent(root, { event: "probe.one", goal: g.id, actor: "t", details: { n: 1 } });
  const afterFirst = readFileSync(join(root, "events.jsonl"), "utf8").split("\n").filter(Boolean);
  appendEvent(root, { event: "probe.two", goal: g.id, actor: "t", details: { n: 2 } });
  const afterSecond = readFileSync(join(root, "events.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.deepEqual(afterSecond.slice(0, afterFirst.length), afterFirst);
  assert.equal(afterSecond.length, afterFirst.length + 1);
});

test("readEvents skips malformed lines instead of throwing", () => {
  const root = freshRoot();
  appendEvent(root, { event: "ok.one", actor: "t" });
  appendFileSync(join(root, "events.jsonl"), "{broken\n");
  appendEvent(root, { event: "ok.two", actor: "t" });
  const events = readEvents(root);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.event), ["ok.one", "ok.two"]);
});

test("workflow: start, advance, idempotent re-advance, and completion", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "工作流" }, "t");
  const started = startWorkflow(root, g.id, "engineering-feature", "t");
  assert.equal(started.workflow.stageIndex, 0);
  assert.equal(started.workflow.status, "active");
  assert.equal(started.workflow.stages.length, 6);

  const advanced = advanceWorkflow(root, g.id, {}, "t");
  assert.equal(advanced.workflow.stageIndex, 1);

  const again = advanceWorkflow(root, g.id, { to: "grill" }, "t");
  assert.equal(again.workflow.stageIndex, 1, "re-walking a past stage is a no-op");

  assert.throws(() => advanceWorkflow(root, g.id, { to: "review" }, "t"), /不能跳跃阶段/);
  assert.throws(() => advanceWorkflow(root, g.id, { to: "nope" }, "t"), /未知阶段/);

  for (let i = 0; i < 5; i += 1) advanceWorkflow(root, g.id, {}, "t");
  const done = readGoal(root, g.id);
  assert.equal(done.workflow.status, "completed");
  assert.equal(done.workflow.stageIndex, done.workflow.stages.length - 1);
  assert.equal(readEvents(root).filter((e) => e.event === "workflow.completed").length, 1);
  assert.throws(() => advanceWorkflow(root, g.id, {}, "t"), /状态为 completed/);
});

test("workflow: unknown preset rejected, running workflow protected", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "工作流二" }, "t");
  assert.throws(() => startWorkflow(root, g.id, "no-such-preset", "t"), /未知工作流预设/);
  startWorkflow(root, g.id, "bugfix", "t");
  assert.throws(() => startWorkflow(root, g.id, "bugfix", "t"), /已有进行中的工作流/);
  assert.doesNotThrow(() => startWorkflow(root, g.id, "bugfix", "t", { restart: true }));
});

test("advanceWorkflow on a goal without a workflow is a clear error", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "无工作流" }, "t");
  assert.throws(() => advanceWorkflow(root, g.id, {}, "t"), /没有工作流/);
});

test("validateBoard reports a goal in in_progress without criteria", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "被篡改" }, "t");
  const file = join(root, "goals", `${g.id}.json`);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.status = "in_progress";
  writeFileSync(file, JSON.stringify(raw));
  const problems = validateBoard(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /判据先于执行|没有判据/);
});

test("validateBoard is clean for a normally built board", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "健康" }, "t");
  setCriteria(root, g.id, ["通过"], "t");
  transitionGoal(root, g.id, "planning", {}, "t");
  startWorkflow(root, g.id, "spec-first", "t");
  assert.deepEqual(validateBoard(root), []);
});

test("boardSnapshot groups cards into columns and counts events", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "快照" }, "t");
  transitionGoal(root, g.id, "planning", {}, "t");
  const snap = boardSnapshot(root);
  assert.equal(snap.total, 1);
  assert.equal(snap.byStatus.planning.length, 1);
  assert.equal(snap.byStatus.planning[0].criteria.length, 0);
  assert.equal(snap.byStatus.planning[0].criteriaVerified, false);
  assert.ok(snap.events >= 2);
});

test("no temp files are left behind by atomic writes", () => {
  const root = freshRoot();
  const g = createGoal(root, { title: "原子写" }, "t");
  setCriteria(root, g.id, ["a"], "t");
  const leftovers = readdirSync(join(root, "goals")).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
});

test("two goals with the same title keep independent state", () => {
  const root = freshRoot();
  const a = createGoal(root, { title: "同名" }, "t");
  const b = createGoal(root, { title: "同名" }, "t");
  setCriteria(root, a.id, ["只给甲"], "t");
  assert.equal(readGoal(root, a.id).criteria.length, 1);
  assert.equal(readGoal(root, b.id).criteria.length, 0);
});
