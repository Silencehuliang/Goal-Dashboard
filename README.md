# Goal Dashboard

把工作组织成**目标看板**的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件，并集成
[mattpocock/skills](https://github.com/mattpocock/skills) 的工程工作流。

**只提供 host 半边**：一组 `board_*` 工具 + 一个只读的看板页面路由。
它**刻意不声明 `dsh.client`** —— 这不是偷懒，是修 bug，原因见下一节。

- 目标宿主：DSH 桌面版（`@deepseek-ai/dsh-desktop` **0.2.0-rc.2**，Electron 44 / Node 24）
- 零运行时依赖、零构建步骤、零 `prepare` 脚本
- 安装不会执行任何构建脚本，因此不会撞上 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

---

## 为什么没有浏览器半边（请勿"补回来"）

这个插件的前一版是一个 fork，带浏览器看板。**它让你重启后打不开 DSH 桌面版。**

桌面版崩溃日志（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\`）：

```
Error: web boot: 1 entry did not activate
goal-dashboard: failed
```

机制链条，每一环都有实证：

| 环节 | 事实 |
|---|---|
| 宿主在 web boot 阶段断言**每个 client 条目都激活成功** | 日志原文 `web boot: 1 entry did not activate` |
| 条目激活需要 `dsh.client.inject` 里的模块都能被解析 | 宿主模块注册表按 inject 列表预加载 |
| 上游/旧版 inject 里声明了 `@deepseek-ai/dsh-client-runtime` | 旧 `dsh-graph-host/package.json` |
| **桌面版没有这个包** | `app.asar` 内 289 个 `@deepseek-ai` 包中 0 处出现该名字；一线 client 插件也都**不**注入它 |
| 于是条目激活失败 → 整个 Web UI 起不来 | 与日志一致 |

关键佐证：**上游 dsh-graph 也以完全相同的方式失败**。桌面版 09:33 的崩溃日志
（`crash-2026-10-02T01-33-40-602Z-web-boot.log`）写的是 `dsh-graph: failed` —— 那发生在本仓库存在之前。
也就是说，dsh-graph 从来就没在你的桌面版上工作过。

而早先的验证之所以"通过"，是因为它跑在 **npm 安装的** `@deepseek-ai/dsh@0.2.0-rc.2`（531 个包，**有**
`dsh-client-runtime`）上，而不是**桌面版**（289 个包，**没有**）。**npm CLI 实例不能代理桌面版的 client 半边。**

结论：把看板放在本插件自己的 HTTP 路由上，就彻底没有这个失败面。代价是它不出现在 GUI 页签里 ——
这个取舍是刻意的。`test/safety.test.mjs` 用 8 条断言把这条红线钉死（含「不得声明 `dsh.client`」「不得 import
`@deepseek-ai/*`」「不得有 `prepare` 脚本」），改坏即红。

---

## 安装

```sh
dsh plugin --profile desktop add github:Silencehuliang/Goal-Dashboard
```

然后在 GUI 插件管理器里启用，或确认 profile 的 `dsh.profile.bundles` 中已出现 `goal-dashboard`。

> **重启后即可放心使用**：本插件不参与 Web UI 的组合，因此重启不会再出现打不开的情况。
> 若要先确认，可执行 `dsh --profile desktop --dump-config`，应能看到 `# == goal-dashboard` 层。

卸载：

```sh
dsh plugin --profile desktop remove goal-dashboard
```

> ⚠️ **不要用含空格的本地路径安装**。`dsh plugin add` 会把 specifier 按空格切开（例如
> `link:E:/…/Goal Dashboard/…` 会被拆成两个包）。上面的 `github:` 写法不受影响。

---

## 看板页面

插件若探测到宿主的 `webServer` 服务（web 组合下提供），会注册一个**只读**页面路由：

```
http://127.0.0.1:<port>/goal-dashboard
```

页面是服务端渲染的静态 HTML（零前端依赖、不发任何写请求），刷新即最新。
也可带 `?workspace=<绝对路径>` 指定要看的 workspace。

`webServer` 可能在 `apply()` 之后才激活，因此采用有界轮询注册；**始终探测不到也不会报错**——
headless 组合下工具照常可用，只是没有页面。

---

## 工具（14 个）

| 分组 | 工具 |
|---|---|
| 目标 | `board_create_goal` · `board_list_goals` · `board_show_goal` · `board_archive_goal` |
| 判据 | `board_set_criteria` · `board_mark_criterion` |
| 生命周期 | `board_transition` |
| 历史 | `board_add_note` |
| 工作流 | `board_workflow_start` · `board_workflow_advance` · `board_workflow_status` · `board_skills_catalog` |
| 校验 / 帮助 | `board_validate` · `board_help` |

### 生命周期与判据门禁

```
draft → planning ⇄ collecting → ready → in_progress → review → delivered ⇄ review
                                        ↘ blocked ↙（只能解除回原状态）
```

- `blocked` 必须给出非空 `reason`，且**只能回到进入阻塞前的那个状态**；
- **判据先于执行**：`in_progress` 与 `playing` 之间的门禁是硬的 —— 没有登记任何判据就会被拒绝
  （`board_set_criteria`）。需要强推时才用 `force=true`，并会记录在事件流里。

### 工作流

工作流把 skills 的阶段挂到目标上，每个阶段标注它属于哪条泳道：

```
engineering-feature:
  grill(grill-with-docs@planning) → spec(to-spec@planning) → tickets(to-tickets@collecting)
  → implement(implement@in_progress) → review(code-review@review) → pr(pr@review)
```

内置 5 个预设：`engineering-feature` / `bugfix` / `spec-first` / `spike` / `architecture-deepening`。
`board_workflow_advance` 只能**顺序**推进（跳跃被拒绝），重复推进已走过的阶段是幂等 no-op。

### 技能目录

内置 37 个 mattpocock/skills 技能的**元数据**（名称 / 分类 / 调用方式 / 一行描述），
由 `scripts/gen-skills-catalog.mjs` 从真实仓库生成。**不内置技能正文** —— 请自行从上游安装技能。
见 [ATTRIBUTION.md](ATTRIBUTION.md)。

---

## 数据布局

```
<workspace>/.goal-board/
├── goals/<slug>.json   每个目标一个文件（可直接阅读、可 diff）
└── events.jsonl        只追加事件流 —— 事实来源
```

- 目标文件写入是**原子**的（同目录临时文件 + rename），读者永远看不到半个文件；
- 每次变更都先记事件，事件流只追加、从不重写，因此可以据此复盘"当前状态是怎么来的"；
- `board_validate` 会检查不变式（非法状态、判据门禁被绕过、工作流下标越界），返回问题列表。

---

## 开发

```sh
node --test "test/*.test.mjs"   # 49 个用例
```

- `test/model.test.mjs` —— 状态机与判据门禁（纯函数，17 例）
- `test/store.test.mjs` —— 持久化、事件流、工作流（24 例）
- `test/safety.test.mjs` —— **GUI 安全回归守卫**（8 例）：不得声明 `dsh.client`、不得有 `prepare`、不得 import
  `@deepseek-ai/*`、不得有运行时依赖、工具定义必须严格白名单

### 仓库结构

```
index.js                 插件入口（name / inject / apply，14 个工具 + 可选页面路由）
lib/model.js             状态机、判据规范化、slug（纯函数）
lib/store.js             持久化、事件流、工作流、投影、校验
lib/skills.js            技能目录 + 工作流预设
lib/board.js             服务端渲染的看板 HTML
lib/skills-catalog.json  生成的技能元数据
scripts/gen-skills-catalog.mjs  重新生成上面这份目录
test/                    测试（含 GUI 安全守卫）
cordis.patch.yml         组合包层
```

---

## 已知限制

- **没有 GUI 内页签**。看板走独立 HTTP 页面，这是为安全付出的代价（见开头一节）。
- **未做多进程写入互斥**。同一 `.goal-board/` 被多个进程同时写时，事件流仍只追加，但不会加锁。
- **页面是只读投影**。拖动、改状态请走工具或直接用编辑器改 `goals/*.json`。
- 未在 Linux/macOS 上实测；本版仅针对 Windows 上的 DSH 桌面版验证。

## License

MIT —— 见 [LICENSE](LICENSE) 与 [ATTRIBUTION.md](ATTRIBUTION.md)。
