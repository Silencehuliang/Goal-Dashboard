/**
 * mattpocock/skills catalogue + workflow presets.
 *
 * The catalogue describes the skills; the presets shape them into the ordered
 * process a piece of work should follow. Each preset stage maps a skill onto a
 * goal lifecycle lane, which is what binds the workflow to the board.
 *
 * Upstream: https://github.com/mattpocock/skills (MIT, © 2026 Matt Pocock).
 * We embed derived metadata only — names, categories, invocation kinds and
 * descriptions — and never the skill bodies. See ATTRIBUTION.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { STATUSES } from "./model.js";

const here = fileURLToPath(new URL(".", import.meta.url));

export const SKILLS_SOURCE = "mattpocock/skills (MIT)";
export const SKILLS_UPSTREAM = "https://github.com/mattpocock/skills";

/** 37 entries, generated from a real checkout by scripts/gen-skills-catalog.mjs. */
export const SKILLS_CATALOG = Object.freeze(
  JSON.parse(readFileSync(join(here, "skills-catalog.json"), "utf8")),
);

/**
 * Workflow presets. `lane` is the board column the stage reports into; it must
 * be one of the goal lifecycle statuses (validated below).
 */
export const WORKFLOW_PRESETS = Object.freeze([
  {
    id: "engineering-feature",
    title: "工程特性（完整流程）",
    description: "先对齐、再出规格与工单，然后实现、评审、提 PR。",
    stages: [
      { id: "grill", title: "对齐需求", skill: "grill-with-docs", lane: "planning" },
      { id: "spec", title: "写规格", skill: "to-spec", lane: "planning" },
      { id: "tickets", title: "拆工单", skill: "to-tickets", lane: "collecting" },
      { id: "implement", title: "实现", skill: "implement", lane: "in_progress" },
      { id: "review", title: "代码评审", skill: "code-review", lane: "review" },
      { id: "pr", title: "提交 PR", skill: "pr", lane: "review" },
    ],
  },
  {
    id: "bugfix",
    title: "缺陷修复",
    description: "先建立可复现的反馈回路，再红绿重构，最后评审。",
    stages: [
      { id: "diagnose", title: "定位缺陷", skill: "diagnosing-bugs", lane: "planning" },
      { id: "fix", title: "红绿修复", skill: "tdd", lane: "in_progress" },
      { id: "review", title: "代码评审", skill: "code-review", lane: "review" },
    ],
  },
  {
    id: "spec-first",
    title: "规格优先",
    description: "先规格，再一次性实现整份规格，最后评审。",
    stages: [
      { id: "grill", title: "对齐需求", skill: "grill-me", lane: "planning" },
      { id: "spec", title: "写规格", skill: "to-spec", lane: "planning" },
      { id: "implement", title: "按规格实现", skill: "implement-spec", lane: "in_progress" },
      { id: "review", title: "代码评审", skill: "code-review", lane: "review" },
    ],
  },
  {
    id: "spike",
    title: "技术验证",
    description: "先用一次性原型回答一个设计问题，再落规格。",
    stages: [
      { id: "prototype", title: "原型验证", skill: "prototype", lane: "planning" },
      { id: "research", title: "查证资料", skill: "research", lane: "collecting" },
      { id: "spec", title: "写规格", skill: "to-spec", lane: "planning" },
    ],
  },
  {
    id: "architecture-deepening",
    title: "架构深化",
    description: "先扫描深化机会，再按设计准则落地。",
    stages: [
      { id: "survey", title: "扫描深化机会", skill: "improve-codebase-architecture", lane: "planning" },
      { id: "design", title: "模块设计", skill: "codebase-design", lane: "planning" },
      { id: "tickets", title: "拆工单", skill: "to-tickets", lane: "collecting" },
      { id: "implement", title: "实现", skill: "implement", lane: "in_progress" },
    ],
  },
]);

// Fail loudly at load time rather than letting a bad preset reach the board.
for (const preset of WORKFLOW_PRESETS) {
  if (preset.stages.length === 0) throw new Error(`工作流预设 ${preset.id} 没有阶段`);
  const ids = new Set();
  for (const stage of preset.stages) {
    if (ids.has(stage.id)) throw new Error(`工作流预设 ${preset.id} 阶段 id 重复：${stage.id}`);
    ids.add(stage.id);
    if (!STATUSES.includes(stage.lane)) {
      throw new Error(`工作流预设 ${preset.id} 阶段 ${stage.id} 的 lane 非法：${stage.lane}`);
    }
  }
}

/** Look up a preset by id. */
export function findPreset(id) {
  return WORKFLOW_PRESETS.find((p) => p.id === id) ?? null;
}

/** Materialise a preset's stages into the runtime shape stored on a goal. */
export function presetToStages(preset) {
  return preset.stages.map((s, index) => ({
    id: s.id,
    title: s.title,
    skill: s.skill,
    lane: s.lane,
    index,
    state: index === 0 ? "active" : "pending",
  }));
}

/** Look up a skill by name. */
export function findSkill(name) {
  return SKILLS_CATALOG.find((s) => s.name === name) ?? null;
}

/** The catalogue, optionally filtered by category. */
export function skillCatalog({ category } = {}) {
  if (!category) return SKILLS_CATALOG;
  return SKILLS_CATALOG.filter((s) => s.category === category);
}

/** Every category present, with counts. */
export function skillCategories() {
  const out = {};
  for (const skill of SKILLS_CATALOG) out[skill.category] = (out[skill.category] ?? 0) + 1;
  return out;
}
