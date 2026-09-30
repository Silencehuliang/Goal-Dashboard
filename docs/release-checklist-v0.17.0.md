# dsh-graph v0.17.0 发布检查清单

> 流程沿用 v0.10.0 起确立的做法：主管完成准备并（经负责人授权后）合并 `main` + 打 annotated tag，
> 再由**负责人手动执行 `pnpm publish`**。
> 本文件同时承载 v0.17.0 的 Release Notes 与发布前 / 发布后检查项。
> 版本线说明：本次为 `v0.17.0`（上一发布版本为 `v0.16.1`；版本号连续，属 **feature 线**）。
> 本清单结构对照 [`docs/release-checklist-v0.16.1.md`](release-checklist-v0.16.1.md)。

> **准备阶段未执行任何发布动作**：未 `npm publish`、未打 tag、未创建 GitHub release、未 `git push`、
> 未合并 `main`、未改写 git 历史、未触碰 `engines` 与 `peerDependencies`。
> 是否合并 `main` / 打 tag / 发布由负责人在人工 gate 决定。

**本次执行树**：worktree `.worktrees/g-375-att-01`，分支 `g-375-att-01`，基线 **`6d5500a`**
（= `v0.17.0-test` HEAD，含 g-363 / g-367 / g-371 / g-372 / g-373 / g-374）。
**文档 delta（追加在同一 worktree 的 `7e25c0b` 之上）**：仅改文档 —— 三处平台状态表的 **Windows** 行改为真机结论（macOS 行保持「未验证」），
并按负责人真机证据回填本清单 §0 / §2 / §3.1 / §3.3 / §8；**未改任何代码 / 测试断言 / `engines` / `peerDependencies` / `PLUGIN_VERSION`**（仍 `0.17.0`），
随后在 worktree 内重切 tarball、复算指纹并逐成员比对。详见 §3.3 与 §8 的 delta 说明。
**纪律（准备阶段）**：全部构建 / 测试 / 打包 / 门禁**均在 worktree 内**完成；**未写主树 `dist/`**
（主树 `dist/` 是运行中宿主的资产来源，历史上有 worker 因主树构建争用而静默死亡）；
worktree 缺 `node_modules`，经**符号链接**指向主树只读复用（不入 git，不改 `pnpm-workspace.yaml` / lockfile）。

---

## 0. 相对上一版（v0.16.1）的变更（5 条用户可见 + 1 条维护者可见）

1. **支持 DSH 0.2.0 系宿主**：`engines.dsh` 由 `>=0.1.5-rc.2 <0.1.8-0` 放宽为 `>=0.1.5-rc.2 <0.2.1-0`
   （上界 `-0` 排除 `0.2.1` 的一切预发布与正式版）；隔离实例实测 `0.2.0-rc.1`，负责人 2026-09-30 真机复验 `0.2.0-rc.2`。
2. **目标完成摘要（新）**：目标弹窗新增只读「完成摘要」页签 —— 每次子代理执行的输出自动截获落盘
   （历史 attempt 归档为 `results-att*.md`，零额外 token）；`graph_write_results` / `graph_refresh_results`
   写回摘要并支持一键更新为 LLM 详情级摘要；交回报文按统一骨架与三层字节预算呈现。
3. **窄档搜索按版本 / 分区分组**：侧边栏窄档（<480px）激活搜索时，聚合泳道内的命中加组头与计数，
   仍为单列纵向、零横向溢出；宽档（≥480px）行为与视觉零变化。
4. **隔离实例与看板数据互不污染**：修正「仓库内任意子目录被判为 linked worktree」的判定缺陷 ——
   隔离实例、门禁运行与测试套件不再写入真实 `.dsh-graph`，worktree 内也不再出现与改动无关的假红。
5. **隔离实例可从零重建**：修复 pnpm 12 下 `scripts/dsh-test-web.sh` 无法新建实例（依赖构建放行、
   私有解析根、解析重试），不再需要手工搭运行时绕过。
6. **（维护者可见，不进 CHANGELOG）文档面机器守卫**：README 工具表六面一致性、工具计数、记忆上限取值与 CHANGELOG 版本节结构由测试钉住（改坏即红）。

> 两份 README（根 `README.md` + 包内 `dsh-graph-host/README.md`，中英）已同步「最新亮点（v0.17.0）」；
> 仓库根 `CHANGELOG.md` 新增 `## v0.17.0 — 2026-09-30` 节（5 条要点）。

## 1. v0.17.0 版本内容集（6 个交付目标）

版本主题：**宿主兼容面扩到 DSH 0.2.0 系 + 目标完成摘要 + 窄档搜索分组 + 隔离/数据卫生修复。**

| 目标 | 内容 | 用户/维护者可见效果 |
|---|---|---|
| g-363 | 仓库内 scratch 隔离修复（`core/root.ts` 的 worktree 判定收敛） | 隔离实例 / 门禁 / 测试不再写真实看板数据；worktree 内假红消失 |
| g-367 | 窄档搜索命中按版本 / 分区分组（`lib/client/kanban.js`） | 窄档搜索结果可读性提升，仍单列零横向溢出 |
| g-371 | 文档面机器守卫（仅 `core/tests/**`） | 工具表 / 计数 / 记忆上限 / CHANGELOG 结构「改坏即红」 |
| g-372 | 宿主兼容声明放宽至覆盖 `0.2.0-rc.1`（后经 rc.2 真机复验） | 声明面与实测宿主一致，市场预检不再误判不兼容 |
| g-373 | `scripts/dsh-test-web.sh` 在 pnpm 12 下可从零新建隔离实例 | 真机验证回路恢复可用（发布门禁依赖它） |
| g-374 | 结果摘要规范化重写 + LLM 详情级摘要 + 报文骨架 / 预算 | 看板「完成摘要」页签；交回报文格式统一、字节预算受控 |

## 2. 发布前检查项

- [x] `dsh-graph-host/package.json` version = **`0.17.0`**（第 3 行）
- [x] `dsh-graph-host/lib/client/constants.js` 的 `PLUGIN_VERSION` = **`0.17.0`**（第 12 行），
      并 `bash scripts/build.sh` 重建 `dist/lib/client.js`（第 2212 行含该常量）
- [x] **版本号一致**（发布门禁红线 2）：见 §3.2 逐处 `文件:行` 实测输出
- [x] 两份 README（中 / 英）+ 根 README 同步 v0.17.0 版本表述与「最新亮点（v0.17.0）」，**历史小节原文逐字保留**
- [x] `CHANGELOG.md` 新增 `## v0.17.0 — 2026-09-30` 节（5 条，符合每节 ≤5 条）
- [x] **平台声明如实（红线 1）**：三处平台状态表（根 + 包内中/英）的 **Windows** 行改为
      「**已实测通过 / Verified on-device**」（负责人 2026-09-30 真机完整 T1–T5 = 10 / 失败 0 / 告警 0，见 §3.1）；
      **macOS 三处仍保持「未验证 / Not verified」**（macOS 从未跑过真机门禁，不得与 Windows 混为一谈）
- [x] **宿主门禁命令与 `engines.dsh` 声明一致**：见 §4（`@deepseek-ai/dsh@0.2.0-rc.2`，
      对照 v0.16.0「门禁结论与声明上界不一致」的教训）
- [x] 全量测试 `node --test core/tests/*.test.ts` = **1514 / 1514，fail 0**（§5）
- [x] `./node_modules/.bin/tsc --noEmit -p tsconfig.json` = **exit 0**（§5）
- [x] `node --check dist/lib/client.js` = **OK**（exit 0，§5）
- [x] `(cd dist && pnpm pack --dry-run)` = **通过，37 个文件**（§5）
- [x] tarball 已产出并记录确切文件名 + sha256（红线 3）：见 §3.3
- [x] 文档 delta 后**重切** tarball：最终 sha256 `b5b3e0a4…`；逐成员比对显示除 `package/README.md`
      外 **36 个成员 sha256 逐字节未变**（§3.3）
- [x] Linux 平台门禁（离线静态段）实跑 `P1–P6 + M4` = **通过 9 / 失败 0 / 告警 0**（§6）
- [x] 生产看板污染守卫自查（g-363 修复后的回归）：见 §7
- [x] g-352 冻结签名 fixture 随 `PLUGIN_VERSION` 变更**重新冻结**：正文与 `content-sha256`
      （`0e6b7094…`）**逐字节未变**，仅 provenance 三行更新（description / source-commit / source-sha256）
      —— 维护者工具 + `G352_SIG_ACK=1` 显式 ack，与 v0.16.1 同一做法（见 §5.1）
- [x] CHANGELOG 版本节快照同步更新（`core/tests/g371-changelog-guard.test.ts`）——**补断言，未放宽**（见 §5.1）
- [x] **Windows 原生真机完整门禁已取得**（负责人 2026-09-30，原生 `win32/x64` + 宿主 `0.2.0-rc.2`，
      被验包 `4e11d772…`，T1–T5 = 10 / 失败 0 / 告警 0；见 §3.1）
- [ ] **未做**：macOS 原生真机门禁、合并 `main`、打 tag、`pnpm publish`（后三项为人工 gate）；
      完整门禁 T2–T5 由负责人在 Windows 真机执行（非本 attempt 自跑，见 §8 第 3 条）

## 3. 三条发布红线逐条结论

### 3.1 红线 1 —— Windows 兼容性：**✅ 满足（负责人真机完整 T1–T5：通过 10 / 失败 0 / 告警 0，总判定 PASS）**

| 项 | 值 |
|---|---|
| 本版完整 Windows 原生门禁（T1–T5，含 T2 安装 / T4 实例 / T5 REST） | ✅ **已执行并 PASS** —— 负责人 2026-09-30，原生 Windows（`win32/x64`，node `v24.13.0`）；命令 `node win-smoke-test.mjs --tarball <Windows 侧路径>\dsh-graph-0.17.0.tgz --dsh "npx -y @deepseek-ai/dsh@0.2.0-rc.2"` ⇒ **通过 10 / 失败 0 / 告警 0，总判定 PASS** |
| 被验包（人类证据登记） | `dsh-graph-0.17.0.tgz`，sha256 `4e11d7720e5b46e09623d6c648271c2fda868cd4d93dbc240ada02c1ce1327f7`、547,947 B（**已验包**；最终包指纹与差异见 §3.3 delta 说明） |
| T1 静态门禁 | ✅ PASS（扫描 **15** 个文件） |
| T2 全新隔离 profile 安装 | ✅ PASS（自带依赖 `yaml` 落地；已安装版本 = `0.17.0`） |
| T3 核心运行时 | ✅ PASS（六步流程 + 跨进程并发 CAS「4 抢 1」**恰好 1 成功**） |
| T4 实例启动 / 插件加载 | ✅ PASS |
| T5 路由注册 + 看板载荷 + Web UI | ✅ PASS（Web UI 返回 HTTP 303） |
| 宿主版本 | `@deepseek-ai/dsh@0.2.0-rc.2`（落在 `engines.dsh` 声明区间内，见 §4） |
| 第二机指纹对账 | ✅ Windows `certutil -hashfile … SHA256` 复算结果与产出侧 sha256 **逐字节一致** ⇒ 跨机对账闭合 |
| macOS 原生门禁（本版） | ❌ **未执行**（macOS 从未跑过真机门禁）⇒ README 三处 macOS 行**保持**「未验证 / Not verified」 |
| 红线 1 结论 | **✅ 满足**（Windows 完整真机门禁已取得；macOS 部分如实标注未验证，未读到任何 PASS） |
| README 表述一致性 | ✅ 三处一致：`README.md:35`、`dsh-graph-host/README.md:52`、`dsh-graph-host/README.md:216` 均为「Windows 已实测通过 / Verified on-device」；同三处 macOS 行仍为「未验证 / Not verified」 |
| 最终包是否复跑门禁 | **不重跑**（负责人明示）：最终包与已验包只差 `package/README.md` 的文字，**无代码 / 断言 / 声明变更**，README 文字不影响功能 —— 见 §3.3 与 §8 的 delta 说明 |
| Windows 侧 tarball 取件路径（UNC） | `\\wsl.localhost\archlinux\home\miuzel\workspace\personal\dsh-graph\tmp\win-handoff\`（最终包 + `win-smoke-test.mjs` / `.cmd` 已拷入主树 handoff 目录） |

> `AGENTS.md`「发布门禁」段要求「每个版本发布前必须在原生 Windows 上做一次兼容性测试（T1–T5）」：
> 本版该项**已由负责人在真机完成并取得 PASS**。Linux/WSL2 的离线静态段（§6）**不参与**该结论的推导。
> macOS **仍无**真机结论，故其平台状态三处一律如实写「未验证 / Not verified」——两者口径**分开**，不得合并表述。

### 3.2 红线 2 —— 版本号一致：**✅ 满足（实测输出如下）**

| 位置 | 行 | 实测输出 |
|---|---|---|
| `dsh-graph-host/package.json`（**可发布清单**） | 3 | `"version": "0.17.0",` |
| `dsh-graph-host/lib/client/constants.js` | 12 | `const PLUGIN_VERSION = "0.17.0";` |
| `README.md`（仓库根，中文门面） | 18 | `**当前版本 v0.17.0** —— npm 包名 dsh-graph，…` |
| `dsh-graph-host/README.md`（包内，中文） | 43 | `**当前版本**：v0.17.0（= npm 上已发布的最新版）。…` |
| `dsh-graph-host/README.md`（包内，英文） | 207 | `**Current version**: v0.17.0 (the latest version published on npm).` |
| （构建产物）`dist/lib/client.js` | 2212 | `const PLUGIN_VERSION = "0.17.0";` |
| （包内清单）`dist/package.json` | — | `node -p require('./dist/package.json').version` ⇒ `0.17.0` |
| （tarball 内）`package/package.json` | — | version = `0.17.0`（`tar -xzOf` 实测） |

> **口径说明（避免误判）**：仓库根 `package.json` 是 monorepo 私有清单（`"private": true`），
> **本身没有 `version` 字段**；真正参与发布的是 `dsh-graph-host/package.json`（构建时生成 `dist/package.json`）。
> 故「三处一致」= 上述**可发布清单 version + `PLUGIN_VERSION` + 三份 README 版本表述**全部为 `0.17.0`。
> 原始输出：`tmp/release-0170/3-version-strings.log`（worktree 内）。

### 3.3 红线 3 —— 产物传递纪律（tarball + sha256）：**✅ 满足**

| 项 | 值 |
|---|---|
| 文件名 | `dsh-graph-0.17.0.tgz` |
| 产出方式 | worktree 内 `bash scripts/build.sh` 后 `(cd dist && pnpm pack --pack-destination ../tmp/att02/new)`（**文档 delta 后重切**） |
| 绝对路径（worktree 内） | `/home/miuzel/workspace/personal/dsh-graph/.worktrees/g-375-att-01/tmp/dsh-graph-0.17.0.tgz`（**最终包**，即 `tmp/att02/new/` 产出物；**已验包** `4e11d772…` 归档于同目录 `tmp/att02/old-4e11d772.tgz` 备查） |
| 主树取件副本 | `/home/miuzel/workspace/personal/dsh-graph/tmp/win-handoff/dsh-graph-0.17.0.tgz`（与上同一文件，sha256 相同） |
| 包内版本 | `0.17.0`（`tar -xzOf … package/package.json` 实测） |
| 包内文件数 | **37**（`pnpm pack --dry-run` 清单实数，与 `find dist -type f \| wc -l` = 37 一致） |
| 包内构建中间物 | **零**：清单内无 `*.ts`、无 `core-dist/`、无 `*.map`（`grep -cE '\.ts$\|core-dist\|\.map$'` = 0） |
| 体积 | **548,137 B** |
| **最终包 sha256** | **`b5b3e0a40321d692fdeee78d339db0355bc669a5c7347b49b0185bcc2cc5498d`** |
| 已验包（Windows 门禁用）sha256 | `4e11d7720e5b46e09623d6c648271c2fda868cd4d93dbc240ada02c1ce1327f7`（547,947 B；负责人 2026-09-30 真机 T1–T5 = 10 / 0 / 0，见 §3.1） |
| **delta 说明（已验包 → 最终包）** | 两包**唯一差异是 `package/README.md` 的文字**：平台状态表 Windows 行 ×2（中 / 英各 1 行替换，`diff` 共 2 hunk / 2 行改），**无任何代码 / 断言 / `engines` / `peerDependencies` / 版本串变更**。逐成员 sha256 比对：37 个包内成员中**仅 `README.md` 变化**，其余 **36 个逐字节相同**（`tmp/att02/old.sha` vs `new.sha`） |
| 免复跑依据 | 负责人**明示**：最终包**不再重跑**门禁（README 文字不影响功能）⇒ §3.1 的「已验包」结论**原样适用**于最终包 |
| 发布前 `dist/` 卫生 | `find dist -name '*.tgz' \| wc -l` = **0**；`find dist -type f \| wc -l` = **37** |
| 原始输出 | 首版：`tmp/release-0170/6-pack.log`、`7-sha256.log`、`5-pack-dryrun.log`；delta 重切：`tmp/att02/old.sha`、`tmp/att02/new.sha`、`tmp/att02/readme-delta.diff` |

> **对账纪律（跨机传递唯一渠道 = tarball）**：接收方在 Windows 侧复算同一文件的 sha256，
> 与上表**逐位**一致方可安装验证。注意：**registry 侧**（npm 会重写 tarball）sha256 必然不同 ——
> 跨机对账用 sha256，registry 侧用内容级判据（参见 v0.16.0 清单 §3.3 的实证）。
> 本版**已**在第二台机器复算指纹：负责人在 Windows 侧 `certutil -hashfile … SHA256` 复算，
> 与产出侧 sha256 `4e11d772…` **逐字节一致**（§3.1）；该指纹对应**已验包**，最终包指纹见上表（差异仅为 README 文字）。

## 4. 宿主门禁命令（与 `engines.dsh` 声明一致）

**本版宿主门禁命令**：

```sh
npx -y @deepseek-ai/dsh@0.2.0-rc.2
```

- 声明真源：`dsh-graph-host/package.json` 的 `engines.dsh = ">=0.1.5-rc.2 <0.2.1-0"`
  （`node -p "JSON.stringify(require('./dsh-graph-host/package.json').engines)"` 实测
  `{"node":">=22","dsh":">=0.1.5-rc.2 <0.2.1-0"}`，本版**未改动** `engines` 与 `peerDependencies`）。
- `0.2.0-rc.2` **落在**该声明区间内 ⇒ **门禁结论与声明上界一致**（这正是 v0.16.0
  「门禁结论与声明上界不一致」教训要求逐条核对的那一项）。
- 该版本由**负责人 2026-09-30 真机复验通过**（隔离实例兼容性实测；出处：本目标看板评论 +
  两份 README 的「实测通过的宿主」行）。
- 用于 Windows 真机门禁时（§3.1）：`node win-smoke-test.mjs --tarball <path>\dsh-graph-0.17.0.tgz --dsh "npx -y @deepseek-ai/dsh@0.2.0-rc.2"`。
- **不要**写成 `0.1.7-rc.2` 或旧上界 `<0.1.8-0`（后者是 v0.16.1 的声明值，已在本版放宽）。

## 5. 全量测试与静态门禁（worktree 内实测）

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `node --test core/tests/*.test.ts` | **tests 1514 / pass 1514 / fail 0**，suites 9，exit **0**（duration ≈ 25.9 s） |
| 类型门禁 | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | **exit 0**（无诊断输出） |
| 构建产物语法 | `node --check dist/lib/client.js` | **OK**（exit 0） |
| 打包校验 | `(cd dist && pnpm pack --dry-run)` | 通过，目标 `dsh-graph-0.17.0.tgz`，**37 个文件**，dry-run **不产生** `.tgz` |

原始输出：`tmp/release-0170/4-full-tests.log`、`5-pack-dryrun.log`。

### 5.1 随版本号变更而**同步修断言**的两处（修断言，不是放宽断言）

1. **CHANGELOG 版本节快照**（`core/tests/g371-changelog-guard.test.ts:39`）：该守卫以快照钉住
   「版本节集合 + 每节要点数」，新增 `v0.17.0` 节会以「出现快照外的版本节」变红 ⇒ 快照补一行
   `{ version: "v0.17.0", bullets: 5 }`。**规则本身（严格倒序、每节 1..5 条、无过程痕迹）逐字未动**，
   改动只是把新版本登记进快照 —— 这是该守卫设计要求的发版动作，不是放宽门槛。
2. **g-352 冻结签名 fixture**（`core/tests/fixtures/g352-conv-signature.txt`）：`SIG_SOURCE_FILES =
   ["kanban","constants","narrow-width","helpers"]` **包含 `constants.js`**，故 `PLUGIN_VERSION`
   版本串变更必然改变 `source-sha256`。按维护者工具重新冻结（`G352_SIG_DUMP=1 G352_SIG_ACK=1`）后：
   - `content-sha256` **逐字节未变**：`0e6b7094deafa61e0525d617f792a8da30b9aeba1a3c72cb221ee4061f783ed3`；
   - 仅 provenance 三行更新：description（`core/tests/g352-narrow-width.test.ts:2094`）、
     `source-commit: 6d5500ac…`（基线，HEAD 的祖先，满足溯源断言）、`source-sha256: 2bf46cbd…`。
   - 即：**渲染契约未变，只有版本串来源指纹变了** —— 与 v0.16.1 处理方式一致。

## 6. Linux 平台门禁（离线静态段）实跑：**✅ 通过 9 / 失败 0 / 告警 0**

```sh
node scripts/platform-smoke-test.mjs --static-only .     # → tmp/release-0170/8-platform-static.log
```

| 项 | 判定 | 关键实测值 |
|---|---|---|
| P1 大小写敏感性 | **PASS** | 目标 FS 大小写敏感判定通过（`A`/`a` 为不同实体） |
| P2 软链 root 边界 | **PASS** | 显式软链 root 被拒、realpath 后解析通过 |
| P3 挂载类型识别 | **PASS** | 本地盘（非网络 / tmpfs / overlay / drvfs） |
| P4.a 并发 CAS | **PASS** | 4 进程抢写恰好 1 成功、3 冲突、0 异常 |
| P4.b 原子写 | **PASS** | 16 并发写者全成功、轮询读者 0 撕裂读、无 `.tmp.` 残留 |
| P5 跨 FS rename(EXDEV) | **PASS** | `rename=EXDEV`、源保留、目标未落地、发布物如实抛错（不静默降级为拷贝） |
| P6 locale / 编码 | **PASS** | `locale=C` 下 CJK 正文与 `prompts=14` 资产逐字节往返一致 |
| M4 Linux-only 假设扫描 | **PASS** | 发布路径命中 20 处**全部**已被特性探测 / 回退覆盖；`archived/` 另 41 处仅 INFO |
| T1 静态门禁（转发） | **PASS** | 发布包无 POSIX 专有常量的 ESM 具名导入 |

> **边界（不得外推）**：本节只覆盖**离线静态段**（`--static-only`，使用已构建 `dist/`）。
> **历史注记（准备阶段原纪录，保留）**：**未执行**需要 `npx` 联网的完整段 T2（tarball 安装）/ T3（核心运行时）/ T4（实例启动）/ T5（REST 冒烟）
> —— 见 §8 未做项。
> **更新（2026-09-30，发布收尾）**：Linux 完整段 T2–T5 **已执行** —— Linux 完整段 T2–T5 已由独立验证者对**最终包**实跑：
> probes P1–P6/M4 = 9/0/0、转发 T1–T5 = 10/0/0、宿主 `npx -y @deepseek-ai/dsh@0.2.0-rc.2`、端口 3095、
> 被测包 sha256 `b5b3e0a40321d692fdeee78d339db0355bc669a5c7347b49b0185bcc2cc5498d`、零看板污染（2026-09-30）。
> 本节结论**只对 Linux 成立**，与 Windows 红线（§3.1）无关、不可替代。

## 7. 生产看板污染守卫（g-363 修复后回归自查）

在**主树** `.dsh-graph/` 三个观测点，比较「本次 worktree 测试 + 构建 + 门禁」前后：

| 观测点 | 运行前（实测） | 运行后（实测） | 差值 |
|---|---|---|---|
| `.dsh-graph/project.yaml` md5 | `f8be1ade335c5311061b6b55607610a8` | `f8be1ade335c5311061b6b55607610a8` | **0（未变）** |
| `.dsh-graph/memory/memory.jsonl` md5 | `1172bf2bd233171ad52f1c8f85b867f3` | `1172bf2bd233171ad52f1c8f85b867f3` | **0（未变）** |
| `.dsh-graph/events.jsonl` 行数 | `12453` | `12454` | **+1** |

- 该 **+1** 条已逐条核对：是**主管**在同一时段追加的 `goal.comment_added`（g-375，Windows 真机部分结论），
  时间 `2026-09-30T04:52:44+08:00`、actor `agent:session-3287a541-…`；**没有任何一条由测试 / 构建 / 门禁产生**
  （无 `project.config_set`、无 memory 写入）。
- 即 g-363 修复在本版门禁流程下**得到回归确认**（v0.16.1 期间该风险面仍未关闭，当时依赖本节同样的人工比对）。

## 8. 已知限制与「未做 / 未验证」清单（不阻断准备，但**必须如实登记**）

1. **Windows 完整原生门禁已执行并 PASS**（§3.1，本版该项已关闭）：负责人 2026-09-30 在原生 Windows
   （`win32/x64`，node `v24.13.0`，宿主 `@deepseek-ai/dsh@0.2.0-rc.2`）用**已验包**跑完 T1–T5，
   通过 10 / 失败 0 / 告警 0 ⇒ 发布红线 1 **已满足**。**唯一残留**：门禁跑的是已验包 `4e11d772…`，
   最终包 `b5b3e0a4…` 只差 `package/README.md` 文字，负责人**明示免复跑**（见第 6 条）。
2. **macOS 原生门禁未执行**：README 平台状态表三处均写「未验证 / Not verified」（macOS 从未跑过真机门禁）。
3. **完整门禁 T2–T5 未由本 attempt 自跑**（§6，历史注记——已于 2026-09-30 由独立验证者补做，见第 10 条）：
   本 attempt 只跑**离线静态段**；Windows 侧完整 T1–T5
   结论的出处是**负责人真机执行**（§3.1）。宿主 `0.2.0-rc.2` 另经 g-372 隔离实例 A/B 门验。
4. **未做发布后核验**（全新隔离 profile 安装 → 工具 / 看板 / skill 注册）：属发布后动作。
5. **第二台机器已复算 tarball sha256**（本版该项已关闭）：负责人在 Windows 侧 `certutil -hashfile … SHA256`
   复算，与产出侧 `4e11d772…` 逐字节一致（§3.1）；该指纹对应**已验包**，最终包指纹见 §3.3。
6. **delta 说明（已验包 → 最终包）**：差异**仅** `package/README.md` 的平台状态表 Windows 行（中 / 英各 1 行），
   37 个包内成员中**其余 36 个 sha256 逐字节未变**；无代码 / 断言 / `engines` / `peerDependencies` / 版本串变更
   ⇒ 负责人**明示免复跑门禁**，§3.1 结论原样适用于最终包。
7. **未执行任何发布动作 / 未合并 `main` / 未打 tag**：合并与 tag 由负责人在人工 gate 决定；
   本 worktree 的改动（含本清单）尚未合入任何共享分支。
8. **P1 / P3 的平台限制（非缺陷，只报告）**：本机 ext4 大小写敏感；在大小写不敏感卷上，
   仅大小写不同的 goal id / version slug 会互相别名，脚本按设计给 WARN 并附影响说明。
9. **M4 只覆盖发布路径**：`scripts/archived/` 内仍有 41 处 Linux-only 假设（归档脚本，非发布路径，只列 INFO）。

10. **（已关闭，2026-09-30 发布收尾）Linux 完整段 T2–T5 已由独立验证者对最终包实跑：probes P1–P6/M4 = 9/0/0、
    转发 T1–T5 = 10/0/0、宿主 `npx -y @deepseek-ai/dsh@0.2.0-rc.2`、端口 3095、被测包 sha256
    `b5b3e0a40321d692fdeee78d339db0355bc669a5c7347b49b0185bcc2cc5498d`、零看板污染（2026-09-30）** —— 第 3 条所述
    「本 attempt 未自跑完整段」的历史限制由此在**发布收尾阶段**闭环（原纪录保留于第 3 条）。

## 9. 发布操作（**人工 gate，本阶段未执行**）

完整命令序列见 [`docs/release-handbook.md`](release-handbook.md) **§4「pnpm publish 单包（发布树标准流程）」**。
发布时必须确认的三个易错点（沿用 v0.16.0 / v0.16.1）：

1. **发布目录是 `dist/`，不是 `dsh-graph-host/`** —— 后者是纯源码形态，发出 TS 源码会缺编译产物、宿主 loader 直接失败。
2. **发布前确认 `dist/` 内无 `.tgz`、文件数 37**：`find dist -name '*.tgz' | wc -l` == **0**；
   `find dist -type f | wc -l` == **37**。
3. **`npm login` 是前置**：`npm whoami --registry=https://registry.npmjs.org` 返回 `E401 Unauthorized` 时
   token 已失效，**必须先重新登录**再 publish。

**本次已执行（准备阶段）**：worktree 内版本号抬升 + 两份 README 与 CHANGELOG 同步 + 本清单、
`bash scripts/build.sh`、全量测试、类型 / 语法 / 打包校验、离线静态平台门禁、tarball + sha256 记录；
随后在 `7e25c0b` 之上追加**文档 delta**（三处平台状态表 Windows 行改真机结论 + 本清单 §0 / §2 / §3.1 / §3.3 / §8 回填），
**重切 tarball** 并逐成员比对指纹（仅 `package/README.md` 变化）。
**由负责人在真机完成（非本 attempt）**：Windows 原生完整 T1–T5 门禁（10 / 失败 0 / 告警 0，§3.1）+ Windows 侧 sha256 复算对账。
**本次未执行**：`git tag`、GitHub release、`git push`、`npm publish`、合并 `main`、macOS 原生真机门禁。
