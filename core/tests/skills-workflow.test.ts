/**
 * core/skills.ts + core/workflow.ts 测试：
 * frontmatter 解析、目录/预设完整性、目标工作流的启动/推进/幂等/拒绝与事件落账。
 * 全部在 mkdtempSync 临时 root 上跑，不触碰真实看板。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphError, STATUSES } from "../machine.ts";
import { readEvents } from "../events.ts";
import type { GraphEvent } from "../events.ts";
import { createGoal, init } from "../ops.ts";
import {
  MATTPOCOCK_SKILLS,
  MATTPOCOCK_SKILLS_COUNT,
  MATTPOCOCK_SKILLS_SOURCE,
  WORKFLOW_PRESETS,
  parseSkillDocument,
  parseSkillFrontmatter,
  scanSkillsDir,
  skillCatalog,
  validateWorkflowPresets,
} from "../skills.ts";
import type { SkillEntry, WorkflowPreset } from "../skills.ts";
import {
  advanceWorkflow,
  listWorkflows,
  startWorkflow,
  workflowApiPayload,
  workflowFilePath,
  workflowStatus,
} from "../workflow.ts";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dsh-graph-wf-"));
  init(root);
  return root;
}

function makeGoal(root: string, title = "workflow test"): string {
  // version=standalone ⇒ goals/<id>/goal.md（有目录，可承载 workflow.json）
  return createGoal(root, { title, version: "standalone", actor: "agent:test" });
}

function eventsOf(root: string, goal: string, event: string): GraphEvent[] {
  return readEvents(root).filter((e: GraphEvent): boolean => e.event === event && e.goal === goal);
}

// ---------------------------------------------------------------- frontmatter

test("skills: frontmatter 解析双引号 description（含冒号与转义引号）", () => {
  const text = [
    "---",
    "name: code-review",
    'description: "Review since X: two axes (Standards / Spec) and \\"quoted\\" bits."',
    "disable-model-invocation: true",
    "---",
    "",
    "# Body",
  ].join("\n");
  const fm = parseSkillFrontmatter(text);
  assert.equal(fm.name, "code-review");
  assert.equal(fm.description, 'Review since X: two axes (Standards / Spec) and "quoted" bits.');
  assert.equal(fm.disableModelInvocation, true);
});

test("skills: 单引号 / 裸标量冒号 / 缺省调用开关", () => {
  const single = parseSkillFrontmatter("---\nname: x\ndescription: 'A: B'\n---\n");
  assert.equal(single.description, "A: B");
  assert.equal(single.disableModelInvocation, false);

  const bare = parseSkillFrontmatter("---\nname: y\ndescription: Use when A: B\n---\n");
  assert.equal(bare.description, "Use when A: B");
});

test("skills: CRLF、嵌套块不覆盖顶层键、坏文档抛 SkillParseError 语义", () => {
  const crlf = parseSkillFrontmatter(
    "---\r\nname: pr\r\ndescription: Write a PR.\r\nmetadata:\r\n  description: nope\r\n---\r\n",
  );
  assert.equal(crlf.name, "pr");
  assert.equal(crlf.description, "Write a PR.");

  assert.throws((): void => {
    parseSkillFrontmatter("# no frontmatter here");
  }, /frontmatter/);
  assert.throws((): void => {
    parseSkillFrontmatter("---\ndescription: only\n---\n");
  }, /name/);
});

test("skills: parseSkillDocument 推导 category / invocation / path", () => {
  const entry = parseSkillDocument(
    "---\nname: tdd\ndescription: TDD.\ndisable-model-invocation: true\n---\n",
    "/repo/skills/engineering/tdd/SKILL.md",
  );
  assert.deepEqual(entry, {
    name: "tdd",
    category: "engineering",
    invocation: "user",
    description: "TDD.",
    path: "/repo/skills/engineering/tdd/SKILL.md",
  });

  const noFlag = parseSkillDocument("---\nname: z\ndescription: Z.\n---\n", "/x/skills/misc/z/SKILL.md");
  assert.equal(noFlag.invocation, "model");
  assert.equal(noFlag.category, "misc");
});

test("skills: scanSkillsDir 缺目录返回空、坏文件跳过、好文件按 category/name 排序", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-graph-skills-"));
  assert.deepEqual(scanSkillsDir(join(dir, "does-not-exist")), []);

  mkdirSync(join(dir, "engineering", "alpha"), { recursive: true });
  writeFileSync(join(dir, "engineering", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: A.\n---\n");
  mkdirSync(join(dir, "engineering", "broken"), { recursive: true });
  writeFileSync(join(dir, "engineering", "broken", "SKILL.md"), "not a skill document");
  mkdirSync(join(dir, "productivity", "beta"), { recursive: true });
  writeFileSync(
    join(dir, "productivity", "beta", "SKILL.md"),
    "---\nname: beta\ndescription: B.\ndisable-model-invocation: true\n---\n",
  );

  const found = scanSkillsDir(dir);
  assert.deepEqual(
    found.map((e: SkillEntry): string => `${e.category}/${e.name}/${e.invocation}`),
    ["engineering/alpha/model", "productivity/beta/user"],
  );
});

// -------------------------------------------------------------------- catalog

test("skills: 打包目录完整性（数量/唯一名/字段/分类/path）", () => {
  // 上游 clone 实测 37 个 SKILL.md；计划文档里的「39」是估计值（见 docs/skills-integration.md）。
  assert.ok(
    MATTPOCOCK_SKILLS.length >= 37,
    `打包目录至少应有 37 条（上游 SKILL.md 实测数），实际 ${MATTPOCOCK_SKILLS.length}`,
  );
  assert.equal(MATTPOCOCK_SKILLS.length, MATTPOCOCK_SKILLS_COUNT);
  assert.equal(MATTPOCOCK_SKILLS_SOURCE, "mattpocock/skills (MIT)");

  const names = new Set<string>();
  for (const entry of MATTPOCOCK_SKILLS) {
    assert.ok(entry.name.trim() !== "", "skill name 不得为空");
    assert.ok(!names.has(entry.name), `skill name 重复：${entry.name}`);
    names.add(entry.name);
    assert.ok(entry.description.trim() !== "", `skill ${entry.name} 描述为空`);
    assert.ok(entry.category.trim() !== "", `skill ${entry.name} 分类为空`);
    assert.ok(entry.invocation === "user" || entry.invocation === "model");
    assert.equal(entry.path, `skills/${entry.category}/${entry.name}/SKILL.md`);
  }
  for (const category of ["engineering", "in-progress", "misc", "productivity"]) {
    assert.ok(
      MATTPOCOCK_SKILLS.some((e: SkillEntry): boolean => e.category === category),
      `缺少分类 ${category}`,
    );
  }

  const catalog = skillCatalog();
  assert.equal(catalog.length, MATTPOCOCK_SKILLS.length);
  assert.deepEqual(Object.keys(catalog[0]).sort(), ["category", "description", "invocation", "name"]);
});

test("skills: 与只读 clone 的 SKILL.md 逐条对账（clone 不存在时跳过）", () => {
  const cloneRoot = join(import.meta.dirname, "..", "..", "..", "_ref", "skills", "skills");
  if (!existsSync(cloneRoot)) return; // 无 _ref 的环境（如发布包）跳过

  const upstream = scanSkillsDir(cloneRoot);
  assert.equal(
    upstream.length,
    MATTPOCOCK_SKILLS.length,
    `clone 中 SKILL.md 数量(${upstream.length}) 与打包目录(${MATTPOCOCK_SKILLS.length}) 不一致`,
  );
  const byName = new Map<string, SkillEntry>(
    MATTPOCOCK_SKILLS.map((e: SkillEntry): [string, SkillEntry] => [e.name, e]),
  );
  for (const up of upstream) {
    const bundled = byName.get(up.name);
    assert.ok(bundled, `clone 中的 skill ${up.name} 不在打包目录里`);
    assert.equal(bundled.description, up.description, `skill ${up.name} 的 description 与上游不一致`);
    assert.equal(bundled.category, up.category, `skill ${up.name} 的 category 与上游不一致`);
    assert.equal(bundled.invocation, up.invocation, `skill ${up.name} 的 invocation 与上游不一致`);
  }
});

// -------------------------------------------------------------------- presets

test("presets: 结构合法（skill 存在于目录、lane 是合法机器状态、id 唯一）", () => {
  assert.deepEqual(validateWorkflowPresets(), []);

  const ids = WORKFLOW_PRESETS.map((p: WorkflowPreset): string => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const required of ["engineering-feature", "bugfix", "spec-first"]) {
    assert.ok(ids.includes(required), `缺少必需预设 ${required}`);
  }

  const requiredStages: Record<string, string[]> = {
    "engineering-feature": ["grill-with-docs", "to-spec", "to-tickets", "implement", "code-review", "pr"],
    bugfix: ["diagnosing-bugs", "tdd", "code-review"],
    "spec-first": ["grill-me", "to-spec", "implement-spec", "code-review"],
  };
  const catalogNames = new Set<string>(MATTPOCOCK_SKILLS.map((e: SkillEntry): string => e.name));
  for (const preset of WORKFLOW_PRESETS) {
    for (const stage of preset.stages) {
      assert.ok((STATUSES as readonly string[]).includes(stage.lane), `非法 lane：${stage.lane}`);
      assert.ok(catalogNames.has(stage.skill), `预设 ${preset.id} 引用了目录外的 skill：${stage.skill}`);
    }
  }
  for (const [presetId, skills] of Object.entries(requiredStages)) {
    const preset = WORKFLOW_PRESETS.find((p: WorkflowPreset): boolean => p.id === presetId);
    assert.ok(preset, `缺少预设 ${presetId}`);
    assert.deepEqual(preset.stages.map((s): string => s.skill), skills);
    const stageIds = preset.stages.map((s): string => s.id);
    assert.equal(new Set(stageIds).size, stageIds.length, `预设 ${presetId} 阶段 id 重复`);
  }
});

// ------------------------------------------------------------- workflow state

test("workflow: start → advance → status happy path（含 workflow.json 落点）", () => {
  const root = makeRoot();
  const goal = makeGoal(root);

  assert.equal(workflowStatus(root, goal), null);
  assert.deepEqual(listWorkflows(root, goal), []);

  const started = startWorkflow(root, goal, "engineering-feature", { actor: "agent:test" });
  assert.equal(started.status, "active");
  assert.equal(started.stageId, "grill");
  assert.equal(started.stageTitle, "Grill the idea (docs trail)");
  assert.equal(started.lane, "planning");
  assert.equal(started.stageIndex, 0);
  assert.equal(started.stageCount, 6);
  assert.deepEqual(
    started.stages.map((s): string => s.state),
    ["active", "pending", "pending", "pending", "pending", "pending"],
  );

  const file = workflowFilePath(root, goal);
  assert.equal(file, join(root, "goals", goal, "workflow.json"));
  assert.ok(existsSync(file));

  const second = advanceWorkflow(root, goal, { actor: "agent:test" });
  assert.equal(second.stageId, "spec");
  assert.equal(second.lane, "collecting");
  assert.equal(second.stageIndex, 1);
  assert.deepEqual(
    second.stages.map((s): string => s.state),
    ["done", "active", "pending", "pending", "pending", "pending"],
  );

  let view = advanceWorkflow(root, goal, { to: "tickets" });
  assert.equal(view.stageId, "tickets");
  view = advanceWorkflow(root, goal, { to: "implement" });
  assert.equal(view.stageId, "implement");
  assert.equal(view.lane, "in_progress");
  view = advanceWorkflow(root, goal, { to: "review" });
  assert.equal(view.stageId, "review");
  assert.equal(view.lane, "review");
  view = advanceWorkflow(root, goal, { to: "pr" });
  assert.equal(view.status, "completed");
  assert.equal(view.stageId, "pr");
  assert.equal(view.lane, "delivered");
  assert.equal(view.stageIndex, 5);
  assert.deepEqual(
    view.stages.map((s): string => s.state),
    ["done", "done", "done", "done", "done", "done"],
  );

  assert.deepEqual(workflowStatus(root, goal), view);
  assert.equal(listWorkflows(root, goal).length, 1);
});

test("workflow: 每个阶段转换恰好落一条事件（started/advanced/completed）", () => {
  const root = makeRoot();
  const goal = makeGoal(root);
  startWorkflow(root, goal, "bugfix", { actor: "agent:test" });
  advanceWorkflow(root, goal, { actor: "agent:test" });
  advanceWorkflow(root, goal, { actor: "agent:test" });

  assert.equal(eventsOf(root, goal, "workflow.started").length, 1);
  assert.equal(eventsOf(root, goal, "workflow.stage.advanced").length, 2);
  assert.equal(eventsOf(root, goal, "workflow.completed").length, 1);

  const advanced = eventsOf(root, goal, "workflow.stage.advanced");
  assert.equal(advanced[0].details.from, "diagnose");
  assert.equal(advanced[0].details.to, "fix");
  assert.equal(advanced[0].details.stage_index, 1);
  assert.equal(advanced[0].actor, "agent:test");
  assert.equal(advanced[1].details.to, "review");
  assert.equal(eventsOf(root, goal, "workflow.completed")[0].details.preset, "bugfix");
});

test("workflow: 重复推进到当前/已走过阶段是幂等 no-op（不写文件、不落事件）", () => {
  const root = makeRoot();
  const goal = makeGoal(root);
  startWorkflow(root, goal, "spec-first");
  const first = advanceWorkflow(root, goal, { to: "spec" });
  const advancedCount = eventsOf(root, goal, "workflow.stage.advanced").length;
  const rawBefore = readFileSync(workflowFilePath(root, goal), "utf8");

  const repeatCurrent = advanceWorkflow(root, goal, { to: "spec" });
  assert.deepEqual(repeatCurrent, first);
  const repeatPast = advanceWorkflow(root, goal, { to: "grill" });
  assert.deepEqual(repeatPast, first);

  assert.equal(eventsOf(root, goal, "workflow.stage.advanced").length, advancedCount);
  assert.equal(readFileSync(workflowFilePath(root, goal), "utf8"), rawBefore);

  // 未指定 to 才继续前进
  const next = advanceWorkflow(root, goal);
  assert.equal(next.stageId, "implement");
  assert.equal(eventsOf(root, goal, "workflow.stage.advanced").length, advancedCount + 1);
});

test("workflow: 未知阶段 / 跳跃前进被拒绝（GraphError）", () => {
  const root = makeRoot();
  const goal = makeGoal(root);
  startWorkflow(root, goal, "engineering-feature");

  assert.throws(
    (): void => {
      advanceWorkflow(root, goal, { to: "no-such-stage" });
    },
    (e: unknown): boolean => e instanceof GraphError && /未知阶段/.test((e as Error).message),
  );
  assert.throws(
    (): void => {
      advanceWorkflow(root, goal, { to: "implement" });
    },
    (e: unknown): boolean => e instanceof GraphError && /不允许跳过阶段/.test((e as Error).message),
  );
  // 被拒绝的两次调用都不应留下事件
  assert.equal(eventsOf(root, goal, "workflow.stage.advanced").length, 0);
  assert.equal(workflowStatus(root, goal)?.stageId, "grill");
});

test("workflow: 缺工作流/未知预设/活动工作流重开都按契约报错", () => {
  const root = makeRoot();
  const goal = makeGoal(root);

  assert.throws(
    (): void => {
      advanceWorkflow(root, goal);
    },
    /没有工作流/,
  );
  assert.throws(
    (): void => {
      startWorkflow(root, goal, "no-such-preset");
    },
    /未知工作流预设/,
  );

  startWorkflow(root, goal, "bugfix");
  assert.throws(
    (): void => {
      startWorkflow(root, goal, "spec-first");
    },
    /已有进行中的工作流/,
  );
  // restart=true：旧运行归档进 history，可继续 list/审计
  startWorkflow(root, goal, "spec-first", { restart: true });
  const runs = listWorkflows(root, goal);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].preset, "spec-first");
  assert.equal(runs[1].preset, "bugfix");
  assert.equal(eventsOf(root, goal, "workflow.started").length, 2);
});

test("workflow: 完成后不能再推进", () => {
  const root = makeRoot();
  const goal = makeGoal(root);
  startWorkflow(root, goal, "bugfix");
  advanceWorkflow(root, goal);
  advanceWorkflow(root, goal);
  assert.equal(workflowStatus(root, goal)?.status, "completed");
  assert.throws(
    (): void => {
      advanceWorkflow(root, goal);
    },
    /无法继续推进/,
  );
});

test("workflow: note 记录进运行态与事件详情", () => {
  const root = makeRoot();
  const goal = makeGoal(root);
  startWorkflow(root, goal, "spec-first", { actor: "agent:test" });
  advanceWorkflow(root, goal, { to: "spec", note: "spec 已发布到 issue tracker" });

  const advanced = eventsOf(root, goal, "workflow.stage.advanced");
  assert.equal(advanced.length, 1);
  assert.equal(advanced[0].details.note, "spec 已发布到 issue tracker");
  const runs = listWorkflows(root, goal);
  assert.equal(runs[0].notes.length, 1);
  assert.equal(runs[0].notes[0].text, "spec 已发布到 issue tracker");
});

test("workflow: 重新 init（幂等）后运行态与磁盘投影都保留", () => {
  const root = makeRoot();
  const goal = makeGoal(root);
  startWorkflow(root, goal, "spec-first", { actor: "agent:test" });
  advanceWorkflow(root, goal, { to: "spec" });

  const before = workflowStatus(root, goal);
  assert.ok(before);

  init(root); // 重复初始化不得清掉 goal 目录下的工作流状态

  const after = workflowStatus(root, goal);
  assert.deepEqual(after, before);

  const raw = JSON.parse(readFileSync(workflowFilePath(root, goal), "utf8"));
  assert.equal(raw.version, 1);
  assert.equal(raw.current.id, before.id);
  assert.equal(raw.current.preset, "spec-first");
  assert.deepEqual(
    raw.current.stages.map((s: { state: string }): string => s.state),
    ["done", "active", "pending", "pending"],
  );
  assert.equal(readEvents(root).filter((e: GraphEvent): boolean => e.event === "workflow.started").length, 1);
});

test("workflow: backlog 平铺目标没有目标目录，按既有约定拒绝", () => {
  const root = makeRoot();
  const backlogGoal = createGoal(root, { title: "backlog goal", actor: "agent:test" }); // 无 version → backlog/<id>.md
  assert.throws(
    (): void => {
      startWorkflow(root, backlogGoal, "bugfix");
    },
    /暂存目标（backlog）没有目录/,
  );
  assert.throws(
    (): void => {
      workflowStatus(root, backlogGoal);
    },
    /暂存目标（backlog）没有目录/,
  );
});

test("workflow: workflowApiPayload 命中冻结契约的键形状", () => {
  const root = makeRoot();
  const goal = makeGoal(root);

  const empty = workflowApiPayload(root, goal);
  assert.deepEqual(Object.keys(empty).sort(), ["catalog", "goal", "presets", "workflow"]);
  assert.equal(empty.goal, goal);
  assert.equal(empty.workflow, null);
  assert.ok(empty.presets.length >= 3);
  assert.equal(empty.catalog.length, MATTPOCOCK_SKILLS.length);
  assert.deepEqual(Object.keys(empty.catalog[0]).sort(), ["category", "description", "invocation", "name"]);

  startWorkflow(root, goal, "bugfix");
  const payload = workflowApiPayload(root, goal);
  assert.ok(payload.workflow);
  const keys = Object.keys(payload.workflow);
  assert.equal(keys.length, 11, `workflow 视图键数应为 11，实际 ${keys.join(",")}`);
  for (const key of [
    "id",
    "title",
    "stageId",
    "stageTitle",
    "lane",
    "stageIndex",
    "stageCount",
    "status",
    "stages",
    "startedAt",
    "updatedAt",
  ]) {
    assert.ok(keys.includes(key), `workflow 视图缺少契约键 ${key}`);
  }
  assert.deepEqual(Object.keys(payload.workflow.stages[0]).sort(), ["id", "lane", "skill", "state", "title"]);
});
