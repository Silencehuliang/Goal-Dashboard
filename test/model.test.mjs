import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BoardError, STATUSES, TRANSITIONS, allCriteriaVerified, applyTransition, assertTransition,
  createGoalRecord, criteriaItems, slugify, uniqueSlug, unverifiedCriteria,
} from "../lib/model.js";

const goal = (over = {}) => createGoalRecord({ id: "g1", title: "示例目标", ts: "2026-01-01T00:00:00.000Z", ...over });

test("criteriaItems normalises strings and records, dropping blanks and placeholders", () => {
  const items = criteriaItems({
    criteria: ["  真实判据  ", "", "<criterion>", { text: "第二条", verified: true }, { text: "   " }],
  });
  assert.deepEqual(items, [
    { text: "真实判据", verified: false },
    { text: "第二条", verified: true },
  ]);
});

test("criteriaItems tolerates a missing or malformed criteria field", () => {
  assert.deepEqual(criteriaItems({}), []);
  assert.deepEqual(criteriaItems({ criteria: "nope" }), []);
  assert.deepEqual(criteriaItems(null), []);
});

test("allCriteriaVerified is false when there are no criteria at all", () => {
  assert.equal(allCriteriaVerified({ criteria: [] }), false);
  assert.equal(allCriteriaVerified({ criteria: [{ text: "a", verified: true }] }), true);
  assert.equal(allCriteriaVerified({ criteria: [{ text: "a", verified: true }, { text: "b" }] }), false);
});

test("unverifiedCriteria lists only the outstanding ones", () => {
  const items = unverifiedCriteria({ criteria: [{ text: "a", verified: true }, { text: "b" }] });
  assert.deepEqual(items.map((i) => i.text), ["b"]);
});

test("createGoalRecord starts in draft and validates input", () => {
  const g = goal();
  assert.equal(g.status, "draft");
  assert.equal(g.type, "task");
  assert.deepEqual(g.criteria, []);
  assert.throws(() => createGoalRecord({ id: "x", title: "   ", ts: "t" }), BoardError);
});

test("createGoalRecord falls back to task for an unknown type", () => {
  assert.equal(createGoalRecord({ id: "x", title: "t", type: "bogus", ts: "t" }).type, "task");
});

test("the criteria gate blocks in_progress without criteria", () => {
  const g = applyTransition(goal(), "planning", { ts: "t" });
  assert.throws(
    () => assertTransition(g, "in_progress"),
    (error) => error instanceof BoardError && /判据先于执行/.test(error.message),
  );
});

test("the criteria gate allows in_progress once a criterion exists", () => {
  const g = { ...applyTransition(goal(), "planning", { ts: "t" }), criteria: [{ text: "可以验收", verified: false }] };
  assert.doesNotThrow(() => assertTransition(g, "in_progress"));
});

test("force bypasses the criteria gate", () => {
  const g = applyTransition(goal(), "planning", { ts: "t" });
  assert.doesNotThrow(() => assertTransition(g, "in_progress", { force: true }));
});

test("unknown target status is rejected", () => {
  assert.throws(() => assertTransition(goal(), "nonsense"), /未知状态/);
});

test("no-op transitions are rejected", () => {
  assert.throws(() => assertTransition(goal(), "draft"), /已经处于/);
});

test("blocked requires a reason and returns only to its origin", () => {
  const ready = applyTransition(goal(), "planning", { ts: "t" });
  assert.throws(() => assertTransition(ready, "blocked"), /必须给出非空 reason/);
  const blocked = applyTransition(ready, "blocked", { reason: "等上游修复", ts: "t" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedFrom, "planning");
  assert.equal(blocked.blockReason, "等上游修复");
  assert.throws(() => assertTransition(blocked, "ready"), /只能解除回 planning/);
  const back = applyTransition(blocked, "planning", { ts: "t" });
  assert.equal(back.status, "planning");
  assert.equal(back.blockedFrom, null);
  assert.equal(back.blockReason, null);
});

test("disallowed forward transitions are rejected with the allowed set", () => {
  assert.throws(() => assertTransition(goal(), "delivered"), /不允许的迁移/);
  const delivered = { ...goal(), status: "delivered" };
  assert.doesNotThrow(() => assertTransition(delivered, "review"));
});

test("every status has a transition entry and every target is a known status", () => {
  for (const status of STATUSES) {
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSITIONS, status), `missing ${status}`);
    for (const to of TRANSITIONS[status]) assert.ok(STATUSES.includes(to), `${status} → ${to}`);
  }
});

test("applyTransition does not mutate its input", () => {
  const before = goal();
  const snapshot = JSON.parse(JSON.stringify(before));
  applyTransition(before, "planning", { ts: "t" });
  assert.deepEqual(before, snapshot);
});

test("slugify produces filesystem-safe slugs", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("  Fix: the  BUG!! "), "fix-the-bug");
  assert.equal(slugify("修复看板"), "修复看板");
  assert.equal(slugify("!!!"), "goal");
});

test("uniqueSlug avoids collisions deterministically", () => {
  assert.equal(uniqueSlug("dup", []), "dup");
  assert.equal(uniqueSlug("dup", ["dup"]), "dup-2");
  assert.equal(uniqueSlug("dup", ["dup", "dup-2"]), "dup-3");
});
