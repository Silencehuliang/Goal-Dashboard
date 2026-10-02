# Goal-Dashboard

把工作组织成**目标看板**的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件，并提供 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流与看板泳道的集成。

**Goal-Dashboard 是 [miuzel/dsh-graph](https://github.com/miuzel/dsh-graph) 的 fork**（MIT，见 [ATTRIBUTION.md](ATTRIBUTION.md)），针对 **DSH 桌面版**做了安装路径改造，并在其上叠加 skills 工作流层。

<p align="center">
  <a href="https://github.com/Silencehuliang/Goal-Dashboard"><img src="https://img.shields.io/badge/GitHub-Goal--Dashboard-2f6feb?style=flat-square" alt="GitHub"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license MIT">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.1.5--rc.2%20%3C0.2.1--0-2f6feb?style=flat-square" alt="DSH host range">
  <img src="https://img.shields.io/badge/实测宿主-0.2.0--rc.2-2f6feb?style=flat-square" alt="tested host 0.2.0-rc.2">
</p>

**当前版本 v0.18.0** —— 包名 `goal-dashboard`。一个包同时提供面向 Agent 的 `graph_*` 工具（含 `/api/dsh-graph*` REST 端点）与内嵌 DSH Web 的二维泳道看板。

## 与上游 dsh-graph 的差异

| | 上游 dsh-graph v0.17.0 | Goal-Dashboard v0.18.0 |
|---|---|---|
| npm 包名 | `dsh-graph` | `goal-dashboard` |
| 仓库根 package.json | 私有开发包（`private: true`） | **插件清单本身**（`main` → `dist/index.js`） |
| 构建产物 | `dist/` 仅本地生成（gitignored） | **`dist/` 入库提交** |
| 安装时的构建脚本 | 有 `prepare`（需 pnpm `allowBuilds` 放行） | **无 `prepare`，安装零构建** |
| skills 工作流 | 无 | **内置 mattpocock/skills 目录、工作流预设与目标级工作流状态** |

保留不变（刻意为之，避免破坏既有数据与用户配置）：工具名 `graph_*`、REST 路径 `/api/dsh-graph*`、数据目录 `.dsh-graph`、内部插件 id `dsh-graph-host`、settings namespace `dsh-graph`。

## 安装（DSH 桌面版）

**为什么上游装不上**：上游以 `prepare` 脚本在安装时构建，而 pnpm 默认拒绝执行 git 依赖的构建脚本 —— 桌面版插件管理器里安装 `miuzel/dsh-graph` 会失败并报：

```
ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED
```

Goal-Dashboard 把 `dist/` 预构建产物直接入库，**安装时不需要执行任何构建脚本**，因此不再撞上该限制。

```sh
dsh plugin --profile desktop add github:Silencehuliang/Goal-Dashboard
```

也可以直接在桌面版 GUI 的插件管理器里填入仓库地址。安装后**需要重启 DSH 桌面版**：host 半边（工具 + REST 端点）在进程启动时装配；client 半边（看板）随页面刷新生效。

> ⚠️ **不要用含空格的本地路径安装**。已实测：`dsh plugin add` 会把 specifier 按空格切开 —— 例如
> `link:E:/…/Goal Dashboard/dist` 会被拆成 `Goal` 与 `Dashboard/…` 两个包，甚至真的去公共 registry
> 拉了一个同名的 `Dashboard@1.0.0`（连带 629 个传递依赖）；同样的 specifier 交给 `pnpm add` 则完全正常，
> 所以问题出在 `dsh` 的转发而不是 pnpm。**优先使用上面的 `github:` 写法**（git 克隆目录名不含空格，不受影响）。

宿主兼容范围由 `engines.dsh` 声明为 `>=0.1.5-rc.2 <0.2.1-0 || >=0.2.0-rc.1 <0.2.1-0`。
后面的 `||` 子句不是冗余：在 node-semver 的默认预发布规则下，`0.2.0-rc.1`/`0.2.0-rc.2` **不满足**前一个区间
（该区间没有任何 `0.2.0` 元组的预发布比较器），必须显式补上 `>=0.2.0-rc.1` 才真正覆盖 0.2.0 预发布线。

需要 Node ≥ 22。数据目录、侧边栏用法、工具逐个说明等完整内容见 **[dsh-graph-host/README.md](dsh-graph-host/README.md)**。

## 核心概念

- **基于图的目标管理**：目标是自足实体 —— 自然语言任务 + 动态生成的取证计划与质量判据；任务类型不预先模板化，结构化的是生命周期与求值语义。
- **四阶段生命周期**：`描述 → 收集 → 执行 → 确认`，由引擎强制的状态机：`draft → planning → collecting → ready → in_progress → review → delivered`（任意阶段可进入 `blocked`）。
- **判据先于执行**：进入执行前先登记质量判据，评审按逐条判据核验产出物。
- **上下文卡片**：目标 Runner 的种子上下文，生命周期 `empty → collecting → filled → reviewed`；形态分文本 / 文件 / 图片 / 数据。
- **排期**：Backlog（暂存池）↔ Version（批量质量管理）↔ 独立目标（standalone）；看板泳道顺序是展示态，可拖拽调整。
- **换会话交接**：`graph_handoff` 生成交接文档（board 投影 + 长期记忆 + 环境事实），`graph_claim_supervisor` 由新会话幂等接管。

## skills 工作流集成

把 [mattpocock/skills](https://github.com/mattpocock/skills) 里「一次工程改动要走完的流程」建模为**工作流（workflow）**，挂在目标上，其阶段直接映射到看板泳道：

```text
grill-with-docs → to-spec → to-tickets → implement → code-review → pr
   planning        planning   planning     in_progress    review     review
```

内置 37 个 skills 的目录与 5 个预设工作流（`engineering-feature` / `bugfix` / `spec-first` / `spike` / `architecture-deepening`）。工作流状态落在目标目录下并由既有 append-only 事件流记录。

设计、数据形状、工具与 REST 契约见 **[docs/skills-integration.md](docs/skills-integration.md)**。

## 提供的工具

54 个 `graph_*` 工具，按功能分组（逐个说明见 [dsh-graph-host/README.md](dsh-graph-host/README.md) 或 `graph_help`）：

| 分组 | 工具 |
|------|------|
| 目标生命周期 | `graph_create_goal` · `graph_rename_goal` · `graph_set_description` · `graph_set_goal_type` · `graph_set_goal_tags` · `graph_amend_goal` · `graph_transition` · `graph_postpone_goal` · `graph_archive_goal` · `graph_unarchive_goal` · `graph_delete_goal` · `graph_clean_worktree` · `graph_list_worktrees` |
| 质量判据 | `graph_set_criteria` |
| 上下文卡片 | `graph_add_card` · `graph_fill_card` · `graph_review_card` · `graph_bind_collect_card` · `graph_delete_card` · `graph_convert_card_to_shared` · `graph_convert_card_to_owned` · `graph_attach_shared_card` · `graph_detach_shared_card` · `graph_list_shared_cards` |
| 附件 | `graph_store_attachment` · `graph_delete_attachment` |
| 排期 | `graph_move_goal` |
| 执行派发 | `graph_start_attempt` · `graph_set_directive` · `graph_record_attempt_handoff` · `graph_unbind_goal_child` · `graph_abandon_attempt` |
| 记忆 | `graph_memory_add` · `graph_memory_recall` · `graph_memory_remove` · `graph_memory_replace` |
| 配置管理 | `graph_get_settings` · `graph_update_settings` |
| 校验 / 对账 | `graph_validate` · `graph_rebuild` |
| 状态汇报 | `graph_report_status` · `graph_report_supervisor_status` |
| 评审裁决 | `graph_resolve_accept` |
| 历史讨论 | `graph_add_comment` |
| 完成摘要 | `graph_write_results` · `graph_refresh_results` |
| 换会话 | `graph_handoff` · `graph_claim_supervisor` |
| 工作流 / 技能 | `graph_workflow_list` · `graph_workflow_start` · `graph_workflow_advance` · `graph_workflow_status` · `graph_skills_catalog` |
| 帮助 | `graph_help` |

## 看板（浏览器客户端）

浏览器二维泳道看板：横向为生命周期阶段列（描述 / 收集 / 执行 / 确认 / 交付 / 阻塞），每个版本一条泳道，另有 Backlog 与独立目标区；支持拖拽排期、判据 / 上下文卡片抽屉、实时状态显示、阻塞折叠等。以下为上游虚构演示数据（nebula-notes）截图：

![看板总览](screenshot/screenshot-1.png)
![目标详情弹窗](screenshot/screenshot-2.png)
![侧边栏看板（窄档：阶段列纵向堆叠、工具条折叠为 `⋯ 工具`）](screenshot/sidebar-kanban.png)

## 仓库结构

- `core/` —— 核心层源码（唯一事实源），经 `scripts/sync-core.sh` 编译成 `dist/core/*.js` 进发布包；核心层不依赖 DSH。
- `dsh-graph-host/` —— 插件源码：`index.js`（工具 + REST 端点）、`lib/client/*.js`（看板源模块，拼接产物为 `dist/lib/client.js`）、`cordis.patch.yml`、`supervisor-guide.{zh,en}.md`、`README.md`、`LICENSE`。
- `dist/` —— **发布产物，且入库提交**（这是安装零构建的关键）。
- `schema/`、`docs/`、`scripts/` —— 数据 / 设计文档 / 构建脚本。

## 开发

```sh
pnpm install                          # 需要 bash 在 PATH 上
pnpm build                            # = bash scripts/build.sh，重建 dist/
node --test core/tests/*.test.ts      # 全量测试
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

**改完源码必须 `pnpm build` 并把 `dist/` 一起提交** —— 否则安装到用户机器上的还是旧产物。`core/tests/g312-dist-freshness-g312.test.ts` 会把「改了源码没重建」判红。

## License

MIT。本仓库是 [miuzel/dsh-graph](https://github.com/miuzel/dsh-graph)（Copyright © 2026 miuzel）的 fork，并集成 [mattpocock/skills](https://github.com/mattpocock/skills)（Copyright © 2026 Matt Pocock）的工作流设计 —— 两者的许可与归属见 [ATTRIBUTION.md](ATTRIBUTION.md)，原始许可证见 [dsh-graph-host/LICENSE](dsh-graph-host/LICENSE)。
