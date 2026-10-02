/**
 * Persistence for the goal board.
 *
 * Layout (all plain text, git-friendly):
 *   <workspace>/.goal-board/
 *   ├── goals/<slug>.json     one file per goal — the readable state
 *   └── events.jsonl          append-only log — the source of truth
 *
 * Every mutation appends an event before/with the state write, so the log can
 * always be replayed to explain how the current state came to be. This mirrors
 * the append-only design of miuzel/dsh-graph (MIT — see ATTRIBUTION.md).
 */

import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  BoardError, allCriteriaVerified, applyTransition, createGoalRecord, criteriaItems,
  uniqueSlug, unverifiedCriteria,
} from "./model.js";
import { findPreset, presetToStages, WORKFLOW_PRESETS } from "./skills.js";

export const DATA_DIR = ".goal-board";
export const EVENTS_FILE = "events.jsonl";
export const GOALS_DIR = "goals";

/** Resolve the board root for a workspace. Absolute `config.root` wins. */
export function resolveBoardRoot(workspace, configRoot) {
  if (typeof configRoot === "string" && configRoot.trim().length > 0 && isAbsolute(configRoot)) {
    return resolve(configRoot);
  }
  if (typeof workspace !== "string" || workspace.trim().length === 0) {
    throw new BoardError(
      "需要明确的 workspace（会话的 session.header.cwd 或 sandboxPolicy.workspaceRoot）；当前不可用",
    );
  }
  return resolve(workspace, typeof configRoot === "string" && configRoot.trim() ? configRoot.trim() : DATA_DIR);
}

/** Create the skeleton if missing. Idempotent. */
export function ensureBoard(root) {
  mkdirSync(join(root, GOALS_DIR), { recursive: true });
  const events = join(root, EVENTS_FILE);
  if (!existsSync(events)) writeFileSync(events, "");
  return root;
}

function goalsDir(root) {
  return join(root, GOALS_DIR);
}

function goalFile(root, slug) {
  return join(goalsDir(root), `${slug}.json`);
}

function nowIso() {
  return new Date().toISOString();
}

/** Atomic write: same-directory temp file then rename, so readers never see a half file. */
function writeJsonAtomic(target, value) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  try {
    renameSync(tmp, target);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

/** Append one event. The event log is append-only; nothing here rewrites it. */
export function appendEvent(root, event) {
  ensureBoard(root);
  const record = {
    ts: event.ts ?? nowIso(),
    actor: event.actor ?? "agent:dsh",
    event: event.event,
    goal: event.goal ?? null,
    details: event.details ?? null,
  };
  appendFileSync(join(root, EVENTS_FILE), JSON.stringify(record) + "\n");
  return record;
}

/** Read the whole event log. Malformed lines are skipped rather than fatal. */
export function readEvents(root) {
  const file = join(root, EVENTS_FILE);
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* skip malformed line */ }
  }
  return out;
}

/** All goal slugs currently on disk. */
export function listSlugs(root) {
  const dir = goalsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** Read one goal. Throws BoardError when it does not exist or is unreadable. */
export function readGoal(root, slug) {
  const file = goalFile(root, slug);
  if (!existsSync(file)) {
    const known = listSlugs(root);
    throw new BoardError(
      `目标不存在：${slug}${known.length ? `（现有：${known.join(", ")}）` : "（看板还是空的）"}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new BoardError(`目标文件无法解析：${file}（${error?.message ?? error}）`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BoardError(`目标文件内容不是对象：${file}`);
  }
  return parsed;
}

function writeGoal(root, goal) {
  writeJsonAtomic(goalFile(root, goal.id), goal);
  return goal;
}

/** List goals, optionally filtered. Never throws on a single corrupt file. */
export function listGoals(root, { status, includeArchived = false, type } = {}) {
  const out = [];
  for (const slug of listSlugs(root)) {
    let goal;
    try { goal = readGoal(root, slug); } catch { continue; }
    if (!includeArchived && goal.archived === true) continue;
    if (status && goal.status !== status) continue;
    if (type && goal.type !== type) continue;
    out.push(goal);
  }
  return out;
}

/** Create a goal in `draft`. Returns the created record. */
export function createGoal(root, { title, type = "task", description = "" }, actor) {
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new BoardError("目标标题不能为空");
  }
  const slug = uniqueSlug(title, listSlugs(root));
  const ts = nowIso();
  const goal = createGoalRecord({ id: slug, title, type, description, ts });
  writeGoal(root, goal);
  appendEvent(root, {
    event: "goal.created", goal: slug, actor, ts,
    details: { title: goal.title, type: goal.type },
  });
  return goal;
}

/** Replace the criteria list, optionally marking specific items verified. */
export function setCriteria(root, slug, criteria, actor, { verified = [] } = {}) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new BoardError("criteria 必须是非空字符串数组（判据先于执行）");
  }
  const goal = readGoal(root, slug);
  const verifiedTexts = new Set((Array.isArray(verified) ? verified : []).map((v) => String(v).trim()));
  const items = criteria
    .map((c) => String(c ?? "").trim())
    .filter((c) => c.length > 0)
    .map((text) => ({ text, verified: verifiedTexts.has(text) }));
  if (items.length === 0) throw new BoardError("criteria 全为空字符串，未登记任何判据");
  const next = { ...goal, criteria: items, updatedAt: nowIso() };
  writeGoal(root, next);
  appendEvent(root, {
    event: "criteria.set", goal: slug, actor, ts: next.updatedAt,
    details: { count: items.length, verified: items.filter((i) => i.verified).length },
  });
  return next;
}

/** Mark one criterion verified or unverified, by exact text (or unique prefix). */
export function markCriterion(root, slug, text, verified, actor) {
  const goal = readGoal(root, slug);
  const needle = String(text ?? "").trim();
  if (needle.length === 0) throw new BoardError("criterion 不能为空");
  const items = criteriaItems(goal);
  const matches = items.filter((c) => c.text === needle || c.text.startsWith(needle));
  if (matches.length === 0) throw new BoardError(`没有匹配的判据：${needle}`);
  if (matches.length > 1) {
    throw new BoardError(`判据片段不唯一（${matches.length} 条匹配）：${needle}；请给出更长的片段`);
  }
  const target = matches[0].text;
  const next = {
    ...goal,
    criteria: items.map((c) => (c.text === target ? { ...c, verified: verified === true } : c)),
    updatedAt: nowIso(),
  };
  writeGoal(root, next);
  appendEvent(root, {
    event: verified === true ? "criteria.verified" : "criteria.unverified",
    goal: slug, actor, ts: next.updatedAt, details: { criterion: target },
  });
  return next;
}

/** Validate then apply a lifecycle transition. */
export function transitionGoal(root, slug, to, { reason, force } = {}, actor) {
  const goal = readGoal(root, slug);
  const next = applyTransition(goal, to, { reason, force, ts: nowIso() });
  writeGoal(root, next);
  appendEvent(root, {
    event: "goal.transitioned", goal: slug, actor, ts: next.updatedAt,
    details: { from: goal.status, to: next.status, reason: reason ?? null, force: force === true },
  });
  return next;
}

/** Append a traceable note to a goal's history. */
export function addNote(root, slug, text, actor) {
  const body = String(text ?? "").trim();
  if (body.length === 0) throw new BoardError("note 不能为空");
  const goal = readGoal(root, slug);
  const ts = nowIso();
  const next = { ...goal, notes: [...(Array.isArray(goal.notes) ? goal.notes : []), { ts, text: body }], updatedAt: ts };
  writeGoal(root, next);
  appendEvent(root, { event: "goal.noted", goal: slug, actor, ts, details: { text: body } });
  return next;
}

/** Archive (soft-hide) or restore a goal. Archived goals stay on disk. */
export function setArchived(root, slug, archived, actor) {
  const goal = readGoal(root, slug);
  const next = { ...goal, archived: archived === true, updatedAt: nowIso() };
  writeGoal(root, next);
  appendEvent(root, {
    event: next.archived ? "goal.archived" : "goal.unarchived",
    goal: slug, actor, ts: next.updatedAt, details: null,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Skills workflow, attached to a goal
// ---------------------------------------------------------------------------

/** Start a workflow preset on a goal. Refuses to silently discard a running one. */
export function startWorkflow(root, slug, presetId, actor, { restart = false } = {}) {
  const preset = findPreset(presetId);
  if (!preset) {
    throw new BoardError(
      `未知工作流预设：${presetId}（可选：${WORKFLOW_PRESETS.map((p) => p.id).join(" / ")}）`,
    );
  }
  const goal = readGoal(root, slug);
  if (goal.workflow && goal.workflow.status === "active" && restart !== true) {
    throw new BoardError(
      `目标 ${slug} 已有进行中的工作流「${goal.workflow.presetId}」；如要重开请传 restart=true`,
    );
  }
  const ts = nowIso();
  const stages = presetToStages(preset);
  const workflow = {
    presetId: preset.id,
    title: preset.title,
    status: "active",
    stageIndex: 0,
    stages,
    startedAt: ts,
    updatedAt: ts,
  };
  const next = { ...goal, workflow, updatedAt: ts };
  writeGoal(root, next);
  appendEvent(root, {
    event: "workflow.started", goal: slug, actor, ts,
    details: { preset: preset.id, stage: stages[0].id, stageCount: stages.length },
  });
  return next;
}

/** Advance to the next stage (or to a named next stage). Re-walking is a no-op. */
export function advanceWorkflow(root, slug, { to, note } = {}, actor) {
  const goal = readGoal(root, slug);
  const wf = goal.workflow;
  if (!wf) throw new BoardError(`目标 ${slug} 没有工作流，请先调用 board_workflow_start`);
  if (wf.status !== "active") throw new BoardError(`工作流状态为 ${wf.status}，无法继续推进`);

  const requested = typeof to === "string" ? to.trim() : "";
  if (requested.length > 0) {
    const index = wf.stages.findIndex((s) => s.id === requested);
    if (index < 0) {
      throw new BoardError(
        `未知阶段：${requested}（可选：${wf.stages.map((s) => s.id).join(" / ")}）`,
      );
    }
    if (index < wf.stageIndex) {
      return goal; // idempotent: already walked
    }
    if (index > wf.stageIndex + 1) {
      throw new BoardError(`不能跳跃阶段：当前 ${wf.stages[wf.stageIndex].id}，目标 ${requested}`);
    }
  }

  const stageIndex = wf.stageIndex + 1;
  const done = stageIndex >= wf.stages.length;
  const ts = nowIso();
  const next = {
    ...goal,
    workflow: {
      ...wf,
      stageIndex: done ? wf.stages.length - 1 : stageIndex,
      status: done ? "completed" : "active",
      updatedAt: ts,
    },
    updatedAt: ts,
  };
  writeGoal(root, next);
  appendEvent(root, {
    event: "workflow.stage.advanced", goal: slug, actor, ts,
    details: {
      from: wf.stages[wf.stageIndex].id,
      to: done ? null : wf.stages[stageIndex].id,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    },
  });
  if (done) {
    appendEvent(root, { event: "workflow.completed", goal: slug, actor, ts, details: { preset: wf.presetId } });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/** Derive the board view: columns, cards, and counters. */
export function boardSnapshot(root, { includeArchived = false } = {}) {
  const goals = listGoals(root, { includeArchived });
  const byStatus = {};
  for (const goal of goals) {
    (byStatus[goal.status] ??= []).push({
      id: goal.id,
      title: goal.title,
      type: goal.type,
      archived: goal.archived === true,
      blockedFrom: goal.blockedFrom ?? null,
      blockReason: goal.blockReason ?? null,
      // The full list, not a count: the board verifies each criterion in place.
      criteria: criteriaItems(goal),
      criteriaVerified: allCriteriaVerified(goal),
      unverified: unverifiedCriteria(goal).length,
      notes: (Array.isArray(goal.notes) ? goal.notes : []).length,
      workflow: goal.workflow
        ? {
            presetId: goal.workflow.presetId,
            stage: goal.workflow.stages[goal.workflow.stageIndex]?.id ?? null,
            stageIndex: goal.workflow.stageIndex,
            stageCount: goal.workflow.stages.length,
            status: goal.workflow.status,
          }
        : null,
      updatedAt: goal.updatedAt,
    });
  }
  return {
    root,
    generatedAt: nowIso(),
    total: goals.length,
    byStatus,
    events: readEvents(root).length,
  };
}

/** Invariant check. Returns a list of human-readable problems (empty = healthy). */
export function validateBoard(root) {
  const problems = [];
  for (const slug of listSlugs(root)) {
    let goal;
    try {
      goal = readGoal(root, slug);
    } catch (error) {
      problems.push(`${slug}: 无法读取（${error?.message ?? error}）`);
      continue;
    }
    if (goal.id !== slug) problems.push(`${slug}: id 字段（${goal.id}）与文件名不一致`);
    if (!Array.isArray(goal.criteria)) problems.push(`${slug}: criteria 不是数组`);
    if (goal.status === "in_progress" && criteriaItems(goal).length === 0) {
      problems.push(`${slug}: 处于 in_progress 却没有判据（违反「判据先于执行」不变式）`);
    }
    if (goal.status === "blocked" && !goal.blockedFrom) {
      problems.push(`${slug}: 处于 blocked 但缺少 blockedFrom`);
    }
    if (goal.workflow) {
      const wf = goal.workflow;
      if (!Array.isArray(wf.stages) || wf.stages.length === 0) problems.push(`${slug}: workflow.stages 为空`);
      else if (typeof wf.stageIndex !== "number" || wf.stageIndex < 0 || wf.stageIndex >= wf.stages.length) {
        problems.push(`${slug}: workflow.stageIndex 越界（${wf.stageIndex}）`);
      }
    }
  }
  return problems;
}
