# mattpocock/skills 工作流集成（core 层设计）

> 状态：**core 层已实现**（`core/skills.ts`、`core/workflow.ts`、`core/tests/skills-workflow.test.ts`）。
> 工具注册、REST 路由、GUI 展示属于适配层工作，见文末「尚未实现」。
>
> 上游：[mattpocock/skills](https://github.com/mattpocock/skills)（MIT，Copyright (c) 2026 Matt Pocock）。

## 0. 一句话

把 Matt Pocock 的 skill 串成**有序阶段**（预设 preset），挂到看板里的某个目标上，
在**既有**的目标目录与事件流里记录「现在走到哪个阶段」，让 GUI/工具层能回答
「这个目标该调用哪个 skill 了」。

## 1. 什么是「工作流」（workflow）

- **skill**：上游仓库里的一个 `SKILL.md`，是给 agent 读的作业指导书（本项目**不分发正文**，
  只打包 frontmatter 元数据用于展示与路由）。
- **预设（preset）**：一条把若干 skill 排成先后顺序的**路线**。阶段之间是顺序关系，
  一次只能前进一格（不做并行/分支，见「尚未实现」）。
- **工作流运行态（workflow run）**：某个**目标**上的一次预设执行。
  状态 = 当前阶段 + 每个阶段的 `done|active|pending|skipped`，持久化在
  `<goalDir>/workflow.json`，并把每次变更追加到既有的 `events.jsonl`。

关键约束：**工作流不替目标做状态迁移**。阶段上的 `lane` 只是「这个阶段进行时，目标应该处在
哪条看板泳道」的声明，供 GUI 提示；自动把目标搬到该泳道**尚未实现**（见 §7）。

## 2. 目录（catalog）

`MATTPOCOCK_SKILLS: SkillEntry[]` 是对上游 `_ref/skills` clone 的**逐条**打包：

| 字段 | 含义 |
| --- | --- |
| `name` | frontmatter `name`（如 `code-review`） |
| `category` | 目录名：`engineering` \| `in-progress` \| `misc` \| `productivity` |
| `invocation` | `user` = `disable-model-invocation: true`（**只能用户显式调用**）；`model` = 模型可自动调用 |
| `description` | **逐字**取自上游 frontmatter，未改写、未翻译 |
| `path` | 上游相对路径 `skills/<category>/<name>/SKILL.md`（**不是**本地可解析路径） |

来源标注：`MATTPOCOCK_SKILLS_SOURCE = "mattpocock/skills (MIT)"`、
`MATTPOCOCK_SKILLS_LICENSE = "MIT"`、`MATTPOCOCK_SKILLS_UPSTREAM = <repo url>`；
条目数见 `MATTPOCOCK_SKILLS_COUNT`（当前 **37**，见 §8 已知偏差）。

`skillCatalog()` 输出契约用的四字段形状 `{name, category, invocation, description}`；
`scanSkillsDir(root)` 用于把任意本地目录树（例如用户自己 clone 的上游仓库）扫成同样的条目，
缺目录返回 `[]`、单个坏文件跳过、不抛错。

## 3. 预设（preset）与泳道映射

`WORKFLOW_PRESETS: WorkflowPreset[]`，每个阶段 `{id, title, skill, lane}`：

| preset id | 阶段顺序（skill） |
| --- | --- |
| `engineering-feature` | grill-with-docs → to-spec → to-tickets → implement → code-review → pr |
| `bugfix` | diagnosing-bugs → tdd → code-review |
| `spec-first` | grill-me → to-spec → implement-spec → code-review |
| `spike` | prototype → research → tdd → code-review |
| `architecture-deepening` | improve-codebase-architecture → codebase-design → grill-with-docs → to-tickets → implement → code-review |

`lane` ∈ `core/machine.ts#STATUSES` = `draft | planning | collecting | ready | in_progress |
review | delivered | blocked`。当前映射（**建议语义，非自动迁移**）：

| 阶段性质 | lane | 与既有状态机的关系 |
| --- | --- | --- |
| 问询/扫机会/设计（grill、scan、design、prototype、diagnose） | `planning` | 对应「规划中」 |
| 合成 spec、查资料、收集证据 | `collecting` | 对应「收集中」 |
| 拆工单完成、可开工（to-tickets） | `ready` | 对应「就绪」 |
| 实现（implement / implement-spec / tdd） | `in_progress` | 进入该状态在既有机器中另有判据门禁（见下） |
| 双轴评审（code-review） | `review` | 对应「复核中」 |
| 写 PR（pr） | `delivered` | 对应「已交付」 |

> 注意：既有机器的 `planning → in_progress` 需要 `rules_snapshot` + 非空质量判据 +
> `criteria.confirmed` 事件（`core/machine.ts#assertTransition`）。工作流**不会**绕过这些门禁——
> 它只描述路线，真正的状态迁移仍须走 `graph_transition`。
>
> `draft`（= backlog、尚未排期）与 `blocked` 目前没有任何预设阶段使用；`blocked` 只在运行态
> `status` 上保留取值（当前无写入方）。

`validateWorkflowPresets()` 返回结构问题列表（空 = 通过）：阶段 skill 必须在 catalog 中、
lane 必须是合法状态、preset/阶段 id 不得重复。测试与宿主自检共用这一个函数。

## 4. 运行态与持久化

### 4.1 `<goalDir>/workflow.json`

目标目录由既有 `core/ops.ts#findGoalFile` 解析 goal.md 得到（`goals/<id>/`、
`versions/<v>/goals/<id>/`、归档目录同理）。**backlog 平铺目标（`backlog/<id>.md`）没有目标目录**，
与建卡 / attempt 的既有约定一致，直接抛 `GraphError("暂存目标（backlog）没有目录…")`。

```json
{
  "version": 1,
  "current": {
    "id": "wf-1a2b3c4d",
    "goal": "g-012",
    "preset": "bugfix",
    "title": "Bugfix: diagnose → TDD → review",
    "status": "active",
    "stageIndex": 1,
    "stages": [
      { "id": "diagnose", "title": "…", "skill": "diagnosing-bugs", "lane": "planning", "state": "done" },
      { "id": "fix", "title": "…", "skill": "tdd", "lane": "in_progress", "state": "active" },
      { "id": "review", "title": "…", "skill": "code-review", "lane": "review", "state": "pending" }
    ],
    "notes": [{ "ts": "2026-10-02T10:00:00+08:00", "text": "…" }],
    "startedAt": "2026-10-02T09:59:00+08:00",
    "updatedAt": "2026-10-02T10:00:00+08:00"
  },
  "history": []
}
```

- `current` = 最近一次运行（active / completed / blocked 都留在 `current`，所以完成后仍能读到视图）。
- `history` = 被 `restart=true` 归档的旧运行（新→旧）。
- 写入走 `core/platform.ts#replaceFileAtomic`（临时文件 + 原子替换），失败清理临时文件。
- `version` 不匹配时拒绝读取（抛 `GraphError`），避免把未来格式当成本版解释。

### 4.2 事件流（审计的第二事实源）

复用既有 `core/events.ts#appendEvent`（**不写第二份日志**），`goal` 字段填目标 id：

| event | 触发 | `details` |
| --- | --- | --- |
| `workflow.started` | 启动/重开 | `workflow_id, preset, stage, stage_count` |
| `workflow.stage.advanced` | 每次前进一格 | `workflow_id, preset, from, to, stage_index[, note]` |
| `workflow.completed` | 进入最后一个阶段时（与上面那条同一次调用各记一条） | `workflow_id, preset, stage, stage_count` |

幂等 no-op **不落事件**，因此「事件条数 = 真实状态变更次数」，
`events.jsonl` 可用于核账（测试断言了这一点）。

### 4.3 推进语义

| 输入 | 行为 |
| --- | --- |
| `to` 省略 | 前进到下一阶段（`stageIndex + 1`） |
| `to` = 下一阶段 id | 同上 |
| `to` = 当前阶段 id / 已走过的阶段 id | **幂等 no-op**：不改文件、不落事件、返回当前视图 |
| `to` = 未知 id | `GraphError("未知阶段：…")` |
| `to` = 跳跃（index > current+1） | `GraphError("不允许跳过阶段：…")` |
| 无运行态 | `GraphError("目标 … 没有工作流，请先 startWorkflow")` |
| 运行态 status ≠ active | `GraphError("工作流 … 状态为 completed/blocked，无法继续推进")` |
| 启动时已有 active 且未传 `restart` | `GraphError("已有进行中的工作流…")`（不静默丢进度） |
| 启动时传 `restart=true` | 旧运行移入 `history` 后重开 |

## 5. 导出 API

### `core/skills.ts`（零 DSH 依赖）

```ts
parseSkillFrontmatter(text: string): SkillFrontmatter            // {name, description, disableModelInvocation}
parseSkillDocument(text: string, sourcePath: string): SkillEntry // 含 category/invocation/path
scanSkillsDir(root: string): SkillEntry[]                        // 容错：缺目录 → []，坏文件跳过
skillCatalog(entries?: readonly SkillEntry[]): SkillCatalogItem[]
findSkill(name: string, entries?: readonly SkillEntry[]): SkillEntry | null
findPreset(id: string, presets?: readonly WorkflowPreset[]): WorkflowPreset | null
validateWorkflowPresets(presets?, catalog?): string[]
const MATTPOCOCK_SKILLS: SkillEntry[]
const MATTPOCOCK_SKILLS_COUNT: number
const MATTPOCOCK_SKILLS_SOURCE | _LICENSE | _UPSTREAM: string
const WORKFLOW_PRESETS: WorkflowPreset[]
class SkillParseError extends Error
```

### `core/workflow.ts`

```ts
workflowFilePath(root: string, goalSlug: string): string   // <goalDir>/workflow.json
startWorkflow(root, goalSlug, presetId, opts?: {actor?, restart?}): WorkflowStatusView
advanceWorkflow(root, goalSlug, opts?: {to?, note?, actor?}): WorkflowStatusView
workflowStatus(root: string, goalSlug: string): WorkflowStatusView | null
listWorkflows(root: string, goalSlug: string): WorkflowRun[]     // current 在前，history 次之
listPresets(presets?: readonly WorkflowPreset[]): WorkflowPreset[]
workflowApiPayload(root: string, goalSlug: string): WorkflowApiPayload  // GET 的 JSON body
const WORKFLOW_FILE_NAME | WORKFLOW_FILE_VERSION | DEFAULT_WORKFLOW_ACTOR
const WORKFLOW_EVENT_STARTED | _ADVANCED | _COMPLETED
```

## 6. 冻结契约：REST + 工具

### 6.1 REST

```http
GET /api/dsh-graph/workflow?workspace=<ws>&goal=<slug>   → 200 JSON
```

```json
{
  "goal": "g-012",
  "workflow": null,
  "presets": [{ "id": "bugfix", "title": "…", "description": "…", "stages": [ … ] }],
  "catalog": [{ "name": "tdd", "category": "engineering", "invocation": "model", "description": "…" }]
}
```

`workflow` 非空时**恰好**是这些键（`workflowApiPayload` 逐键生成，无额外字段）：

```json
{
  "id": "wf-1a2b3c4d",
  "title": "Bugfix: diagnose → TDD → review",
  "stageId": "fix",
  "stageTitle": "Fix test-first (red → green)",
  "lane": "in_progress",
  "stageIndex": 1,
  "stageCount": 3,
  "status": "active",
  "stages": [{ "id": "fix", "title": "…", "skill": "tdd", "lane": "in_progress", "state": "active" }],
  "startedAt": "2026-10-02T09:59:00+08:00",
  "updatedAt": "2026-10-02T10:00:00+08:00"
}
```

- `status` ∈ `active | completed | blocked`；`state` ∈ `done | active | pending | skipped`。
- `workspace` → `root` 的解析由路由层做（既有 `resolveCanonicalRoot` 约定），
  `workflowApiPayload(root, goal)` 只接受已解析好的 root。
- 目标不存在 / 有工作流但位于 backlog：抛 `GraphError`，按既有 REST 错误映射处理。

### 6.2 工具（由 Lead 在 `dsh-graph-host/index.js` 注册，本模块不注册工具）

| 工具 | 入参 | 转发到 |
| --- | --- | --- |
| `graph_workflow_list` | `{}`（或 `{goal?}`） | `listPresets()` +（有 goal 时）`listWorkflows(root, goal)` |
| `graph_workflow_start` | `{goal, preset}` | `startWorkflow(root, goal, preset, {actor})` |
| `graph_workflow_advance` | `{goal, to?, note?}` | `advanceWorkflow(root, goal, {to, note, actor})` |
| `graph_workflow_status` | `{goal}` | `workflowStatus(root, goal)` |
| `graph_skills_catalog` | `{}` | `skillCatalog(MATTPOCOCK_SKILLS)` |

适配层示意（root 由会话 workspace 解析，actor 由调用上下文注入）：

```js
import { startWorkflow, advanceWorkflow, workflowStatus } from "./core/workflow.js";
import { resolveCanonicalRoot } from "./core/root.js";

const { root } = resolveCanonicalRoot(config, workspace);
const view = startWorkflow(root, goal, preset, { actor: actorOf(ctx) });
```

## 7. 尚未实现（诚实清单）

1. **工具注册与 REST 路由**：`graph_workflow_*` 与 `GET /api/dsh-graph/workflow` 尚未接线；
   当前只有 core 层函数（本模块的验收只覆盖 core）。路由的 `workspace` 解析、鉴权与错误码映射由适配层负责。
2. **GUI**：看板/抽屉里没有工作流视图；契约已冻结，但界面由客户端团队实现。
3. **不自动迁移目标状态**：阶段 `lane` 只是建议值；不会调用 `transition`，
   也不会自动记录 `rules_snapshot` 或质量判据——进入 `in_progress` 的既有判据门禁保持不变。
4. **`blocked` 运行态无写入方**：类型与视图支持 `status: "blocked"`，但没有工具/函数会写它。
5. **不能从事件流重建投影**：`workflow.json` 是物化结果，`events.jsonl` 是审计记录；
   若 `workflow.json` 丢失/损坏，当前**不会**自动 replay（会抛 `GraphError`）。
6. **不做并发写锁**：`workflow.json` 的读-改-写没有跨进程锁（既有 `withMemoryLock` 只用于 memory）。
   单宿主进程场景足够；多写方并发是已知缺口。
7. **不执行/不分发 skill 正文**：不调用上游 skill、不把 `SKILL.md` 正文打进包；
   只提供「该用哪个 skill」的路由与展示。
8. **不支持分支 / 并行 / 回退**：预设是线性路线；`skipped` 状态在类型中存在但无写入方。
9. **上游版本固定**：目录来自 `_ref/skills` clone 的一次快照，没有自动同步上游的机制
   （`scanSkillsDir` 可用于手动重扫）。

## 8. 已知偏差与许可

- **数量偏差（37 ≠ 39）**：任务书写「39 个 skill」，但 clone 的 `_ref/skills` 磁盘上只有
  **37 个 `SKILL.md`**（engineering 20 / in-progress 6 / misc 4 / productivity 7；
  `skills/deprecated/` 下只有 `README.md`，不是 skill）。`SKILL.md` 之外的目录里没有可解析的 skill 文档。
  上游 `.claude-plugin/plugin.json` 只声明了 27 条（仅 engineering + productivity）。
  因此目录条目数按实测 **37** 交付，测试断言 `>= 37`；`>= 39` 的写法会让验收永远失败。
- **许可**：上游 MIT（Copyright (c) 2026 Matt Pocock）。本仓库只打包 frontmatter 元数据
  （名称/分类/调用方式/描述）并标注来源，未复制正文；再分发时保留本文件的来源说明。
- **正文解析器不依赖 YAML 库**：`parseSkillFrontmatter` 只认顶层 `key: value` 与双引号/单引号/裸标量，
  遇到块标量（`description: >`）会得到空描述；上游当前 37 个文件均为单行描述，测试已对账。
