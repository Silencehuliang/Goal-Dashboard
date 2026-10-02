/**
 * Goal model + lifecycle state machine.
 *
 * Design logic carried over from miuzel/dsh-graph (MIT — see ATTRIBUTION.md):
 *   - a goal is a self-contained entity (natural-language task + explicit quality criteria);
 *   - criteria precede execution — a goal may not enter in_progress without registered criteria;
 *   - the lifecycle is a hard state machine enforced by the engine, not by convention.
 *
 * This module is pure: no filesystem, no DSH APIs, no dependencies.
 */

/** The eight lifecycle states. `blocked` is reachable from anywhere and returns only whence it came. */
export const STATUSES = Object.freeze([
  "draft",
  "planning",
  "collecting",
  "ready",
  "in_progress",
  "review",
  "delivered",
  "blocked",
]);

/** Allowed forward transitions. `blocked` is handled separately (it remembers its origin). */
export const TRANSITIONS = Object.freeze({
  draft: Object.freeze(["planning", "blocked"]),
  planning: Object.freeze(["collecting", "ready", "in_progress", "blocked"]),
  collecting: Object.freeze(["ready", "planning", "in_progress", "blocked"]),
  ready: Object.freeze(["in_progress", "collecting", "blocked"]),
  in_progress: Object.freeze(["review", "collecting", "blocked"]),
  review: Object.freeze(["delivered", "in_progress", "blocked"]),
  delivered: Object.freeze(["review"]),
  blocked: Object.freeze([]),
});

/** Goal kinds. `patch`/`chore` are the quick paths for small changes. */
export const GOAL_TYPES = Object.freeze(["feature", "bug", "task", "improvement", "patch", "chore"]);

/** Every user-visible failure from this plugin is a BoardError (never a bare Error). */
export class BoardError extends Error {
  constructor(message) {
    super(message);
    this.name = "BoardError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalise the criteria list: accept plain strings or {text, verified} records,
 * drop blanks and template placeholders, and always return records.
 */
export function criteriaItems(goal) {
  const raw = Array.isArray(goal?.criteria) ? goal.criteria : [];
  const out = [];
  for (const item of raw) {
    const text = (typeof item === "string" ? item : item?.text ?? "").trim();
    if (text.length === 0) continue;
    if (/^<.*>$/.test(text)) continue; // template placeholder such as <criterion>
    out.push({ text, verified: isRecord(item) ? item.verified === true : false });
  }
  return out;
}

/** True only when there is at least one criterion AND every criterion is verified. */
export function allCriteriaVerified(goal) {
  const items = criteriaItems(goal);
  return items.length > 0 && items.every((c) => c.verified);
}

/** Criteria still outstanding, in declaration order. */
export function unverifiedCriteria(goal) {
  return criteriaItems(goal).filter((c) => !c.verified);
}

/**
 * Validate a transition without mutating anything. Throws BoardError with an
 * actionable message when the move is not allowed.
 */
export function assertTransition(goal, to, options = {}) {
  const reason = typeof options.reason === "string" ? options.reason.trim() : "";
  const force = options.force === true;

  if (!isRecord(goal) || typeof goal.status !== "string") {
    throw new BoardError("目标记录损坏：缺少 status 字段");
  }
  if (!STATUSES.includes(to)) {
    throw new BoardError(`未知状态：${to}（可选：${STATUSES.join(" / ")}）`);
  }
  if (to === goal.status) {
    throw new BoardError(`目标已经处于 ${to}，无需迁移`);
  }

  if (to === "blocked") {
    if (reason.length === 0) throw new BoardError("进入 blocked 必须给出非空 reason");
    return;
  }

  if (goal.status === "blocked") {
    const back = goal.blockedFrom;
    if (!STATUSES.includes(back)) {
      throw new BoardError("目标处于 blocked 但未记录来源状态，无法解除阻塞（请重建该目标）");
    }
    if (to !== back) {
      throw new BoardError(`blocked 只能解除回 ${back}，不能直接进入 ${to}`);
    }
    return;
  }

  const allowed = TRANSITIONS[goal.status] ?? [];
  if (!allowed.includes(to)) {
    throw new BoardError(
      `不允许的迁移：${goal.status} → ${to}（允许：${allowed.join(" / ") || "无"}）`,
    );
  }

  if (to === "in_progress" && !force && criteriaItems(goal).length === 0) {
    throw new BoardError(
      "判据先于执行：进入 in_progress 前必须先登记至少一条质量判据（用 board_set_criteria）",
    );
  }
}

/** Apply a validated transition, returning a new goal record. Pure. */
export function applyTransition(goal, to, options = {}) {
  assertTransition(goal, to, options);
  const ts = options.ts ?? new Date().toISOString();
  const next = { ...goal, status: to, updatedAt: ts };
  if (to === "blocked") {
    next.blockedFrom = goal.status === "blocked" ? goal.blockedFrom : goal.status;
    next.blockReason = String(options.reason).trim();
  } else if (goal.status === "blocked") {
    next.blockedFrom = null;
    next.blockReason = null;
  }
  return next;
}

/** Normalise a title into a stable, filesystem-safe slug. */
export function slugify(title) {
  const base = String(title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length > 0 ? base : "goal";
}

/** Pick a slug that does not collide with `taken`. */
export function uniqueSlug(title, taken = []) {
  const takenSet = new Set(taken);
  const base = slugify(title);
  if (!takenSet.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  throw new BoardError(`无法为标题 ${title} 生成唯一 slug（候选过多）`);
}

/** Construct a fresh goal record in `draft`. */
export function createGoalRecord({ id, title, type = "task", description = "", ts }) {
  const cleanTitle = String(title ?? "").trim();
  if (cleanTitle.length === 0) throw new BoardError("目标标题不能为空");
  const kind = GOAL_TYPES.includes(type) ? type : "task";
  return {
    id,
    title: cleanTitle,
    type: kind,
    status: "draft",
    blockedFrom: null,
    blockReason: null,
    description: String(description ?? ""),
    criteria: [],
    notes: [],
    workflow: null,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** The board columns, in display order, with a human label. */
export function boardColumns() {
  return [
    { status: "draft", label: "描述" },
    { status: "planning", label: "计划" },
    { status: "collecting", label: "收集" },
    { status: "ready", label: "就绪" },
    { status: "in_progress", label: "执行" },
    { status: "review", label: "确认" },
    { status: "delivered", label: "交付" },
    { status: "blocked", label: "阻塞" },
  ];
}
