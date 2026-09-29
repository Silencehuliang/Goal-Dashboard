/**
 * core/tests/g363-scratch-isolation.test.ts
 *
 * g-363 守卫：**仓库内 git-ignored 的 scratch 目录**（测试夹具、隔离实例 workspace）必须是一个
 * **独立看板根**，永远不得落到真实 `.dsh-graph` / 真实 `.worktrees`。
 *
 * 为什么需要（真实故障，非理论风险 —— 2026-09-29 实测复现，见 docs/dev-instance-guide.md）：
 * 旧判定 `realpath(workspace) !== realpath(mainWorktree)` 让**主工作树的任意子目录**都被当成
 * linked worktree 并 canonicalize 到 `<主工作树>/.dsh-graph`。三个出口：
 *   1. `TMPDIR=<仓库>/tmp/… node --test …` ⇒ 测试夹具写真实 project.yaml/events.jsonl；
 *   2. 隔离实例 `tmp/dsh-test/<版本>/workspace` ⇒ 隔离实例写真实 memory.jsonl；
 *   3. 在 linked worktree 内跑全量 ⇒ 47 条与改动无关的假红（夹具读到真实看板 29 个目标、
 *      真实 worktree 注册表）。
 * 同一根因还让 `listWorktrees`/`prepareAttemptWorktree` 把 scratch 夹具的代码工作树解析成真实
 * 仓库 ⇒ 在真实仓库里注册 `.worktrees/g-001-att-01` 之类的夹具残留（污染可累积）。
 *
 * 断言面：
 *  A. 判定基准（根因）：linked worktree 判定基于**包含 workspace 的工作树根**，主工作树的普通
 *     子目录不再被判为 linked；被忽略的 scratch 子目录由 `isScratchWorkspace` 显式标记。
 *  B. 不变量（负向对照，本套件的核心）：把夹具**真的写一遍**（init + createGoal +
 *     writeProjectConfig + listWorktrees + prepareAttemptWorktree），真实看板/真实 worktree
 *     注册表必须一字不沾 —— 断言用本次唯一的 marker 定位，对并发写看板免疫；
 *     把修复回退（判定基准改回 workspace 自身、去掉 scratch 边界）⇒ 本套件必红。
 *  C. 不误伤：linked worktree **根**（`.worktrees/` 被 ignore）仍归一到主工作树；
 *     被跟踪的子目录仍按其工作树项目解析；只有被忽略的子目录才隔离。
 *  D. 干净度：scratch 目录的 `git status` 说的是**外层仓库**的干净度 ⇒ 必须报 unknown，不伪称干净。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createGoal, init, writeProjectConfig } from "../ops.ts";
import {
  _clearCanonicalRootCache,
  discoverGitWorktree,
  isScratchWorkspace,
  resolveCanonicalRoot,
} from "../root.ts";
import { detectWorkspaceCleanliness, listWorktrees, prepareAttemptWorktree } from "../worktree.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** 真实**主工作树**根 —— 在 linked worktree 内跑测试时，真实看板在它下面而不是当前 worktree。 */
function realMainWorktree(): string {
  return resolve(git(REPO_ROOT, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "..");
}

/** 真实（生产）看板根：夹具一旦被 canonicalize，写的就是这里。 */
function realBoardRoot(): string {
  return join(realMainWorktree(), ".dsh-graph");
}

/** 真实仓库的 worktree 注册表（`git worktree list --porcelain` 原文）。 */
function realWorktreeRegistry(): string {
  return git(realMainWorktree(), ["worktree", "list", "--porcelain"]);
}

/** 本次运行唯一 marker：真实看板里出现它 ⇒ 夹具确实写进去了。 */
function uniqueMarker(tag: string): string {
  return `g363-${tag}-${randomUUID()}`;
}

/** 在真实看板的数据文件里搜 marker（只搜目标/卡片/事件与配置文件，避开无关大目录）。 */
function realBoardMentions(marker: string): string[] {
  const board = realBoardRoot();
  if (!existsSync(board)) return [];
  const hits: string[] = [];
  const scan = (file: string) => {
    try {
      if (readFileSync(file, "utf8").includes(marker)) hits.push(file);
    } catch {
      // 读不了（并发删除/权限）视为未命中：marker 断言只关心「写进去了没有」
    }
  };
  const walk = (dir: string, depth = 0) => {
    if (depth > 8) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/\.(md|json|jsonl|yaml)$/.test(name)) scan(p);
    }
  };
  for (const top of ["versions", "backlog", "goals", "shared-cards", "memory"]) {
    const dir = join(board, top);
    if (existsSync(dir)) walk(dir);
  }
  for (const f of ["project.yaml", "order.json", "index.json", "rules.md", "events.jsonl"]) {
    const p = join(board, f);
    if (existsSync(p)) scan(p);
  }
  return hits;
}

/** 在**当前仓库**的 git-ignored `tmp/` 下建一个 scratch 夹具目录（与 AGENTS.md 临时文件纪律一致）。 */
function makeScratchFixture(tag: string): string {
  const dir = join(REPO_ROOT, "tmp", `g363-${tag}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 一个自带 git 的夹具仓库（tmpdir 下），可选择在其内建 linked worktree 与 ignored 子目录。 */
function setupRepo(base: string) {
  const mainDir = join(base, "main-repo");
  execFileSync("git", ["init", "-q", "-b", "main", mainDir]);
  writeFileSync(join(mainDir, ".gitignore"), ".worktrees/\ntmpdata/\n");
  mkdirSync(join(mainDir, "src"), { recursive: true });
  writeFileSync(join(mainDir, "src", "app.ts"), "export {};\n");
  execFileSync("git", ["-C", mainDir, "add", "."]);
  execFileSync("git", ["-C", mainDir, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "init"]);
  const worktreeDir = join(mainDir, ".worktrees", "g-900-att-01");
  execFileSync("git", ["-C", mainDir, "worktree", "add", "-q", "-b", "g-900-att-01", worktreeDir]);
  // ignored 子目录在两侧都真实存在（探测以该目录为 cwd，不存在的路径按「非 scratch」保守处理）
  mkdirSync(join(mainDir, "tmpdata"), { recursive: true });
  mkdirSync(join(worktreeDir, "tmpdata"), { recursive: true });
  return { mainDir, worktreeDir };
}

// ============================================================================
// A. 判定基准（根因）
// ============================================================================

test("g-363 根因：主工作树的普通子目录不再被判为 linked worktree", () => {
  _clearCanonicalRootCache();
  const base = mkdtempSync(join(tmpdir(), "g363-subdir-"));
  try {
    const { mainDir } = setupRepo(base);
    const sub = join(mainDir, "src");

    // 负向对照的「旧判据」：子目录天然满足 realpath(sub) !== realpath(main) ——
    // 旧实现仅凭这一点就把它当成 linked worktree 并 canonicalize 到主树看板。
    assert.notEqual(resolve(sub), resolve(mainDir), "旧判据 workspace !== mainWorktree 对子目录恒为真");

    const info = discoverGitWorktree(sub);
    assert.ok(info, "子目录仍在 git 工作树内，应返回发现结果");
    assert.equal(info.isLinkedWorktree, false, "主工作树的子目录不是 linked worktree");
    assert.equal(info.worktreeRoot, resolve(mainDir), "worktreeRoot = 包含它的工作树根");

    const canonical = resolveCanonicalRoot(undefined, sub);
    assert.equal(canonical.mode, "main-tree", "按 main-tree 解析，不 canonicalize");
    assert.equal(canonical.root, join(sub, ".dsh-graph"), "graph root 落在子目录自己下");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("g-363：仓库 git-ignored tmp/ 下的夹具按独立项目解析（TMPDIR 落仓库内的关键路径）", () => {
  _clearCanonicalRootCache();
  const fixture = makeScratchFixture("fixture");
  try {
    assert.equal(isScratchWorkspace(fixture), true, "仓库内被忽略的 tmp/ 子目录 = scratch");
    assert.equal(discoverGitWorktree(fixture), null, "scratch 不得被当成该仓库的工作树项目");
    const canonical = resolveCanonicalRoot(undefined, fixture);
    assert.equal(canonical.root, join(fixture, ".dsh-graph"), "graph root 落在夹具自己下");
    assert.notEqual(canonical.root, resolve(realBoardRoot()), "绝不等于真实看板");
    assert.equal(canonical.mode, "workspace-fallback", "scratch 走 workspace-local 口径");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("g-363：隔离实例 workspace 形状（tmp/dsh-test/<版本>/workspace）同样按独立项目解析", () => {
  _clearCanonicalRootCache();
  const versionRoot = join(REPO_ROOT, "tmp", "dsh-test", `v-g363-${randomUUID()}`);
  const workspace = join(versionRoot, "workspace");
  mkdirSync(workspace, { recursive: true });
  try {
    assert.equal(isScratchWorkspace(workspace), true, "隔离实例 workspace 位于仓库 tmp/ ⇒ scratch");
    const canonical = resolveCanonicalRoot(undefined, workspace);
    assert.equal(canonical.root, join(workspace, ".dsh-graph"), "隔离实例看板落在自己 workspace 下");
    assert.notEqual(canonical.root, resolve(realBoardRoot()), "隔离实例绝不写真实看板");
  } finally {
    rmSync(versionRoot, { recursive: true, force: true });
  }
});

// ============================================================================
// B. 不变量（负向对照）：夹具真的写一遍，真实看板/真实 worktree 注册表不得被碰
// ============================================================================

test("g-363 不变量：scratch 看板的写入不得落到真实 .dsh-graph", () => {
  _clearCanonicalRootCache();
  const fixture = makeScratchFixture("invariant");
  const marker = uniqueMarker("write");
  try {
    const canonical = resolveCanonicalRoot(undefined, fixture);
    assert.equal(canonical.root, join(fixture, ".dsh-graph"), "前置：graph root 必须是夹具自己");

    // 真的写一遍：骨架 + 目标 + 配置（g-333 出口的形态）
    init(canonical.root);
    createGoal(canonical.root, { title: marker, actor: "test" });
    writeProjectConfig(
      canonical.root,
      { executor: { provider: marker, model: `${marker}-m` } },
      "human:gui",
    );

    assert.ok(existsSync(join(canonical.root, "events.jsonl")), "夹具自己收到事件");
    assert.ok(
      readFileSync(join(canonical.root, "events.jsonl"), "utf8").includes(marker),
      "夹具自己收到目标事件",
    );
    // 不变量：真实看板任何数据文件都不得出现本次 marker
    assert.deepEqual(realBoardMentions(marker), [], "真实看板不得出现夹具写入的内容");
    assert.ok(
      !readFileSync(join(realBoardRoot(), "project.yaml"), "utf8").includes(marker),
      "真实 project.yaml 不得被夹具配置改动",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("g-363 不变量：scratch 看板不得让真实仓库多出 .worktrees 注册（listWorktrees / prepareAttemptWorktree）", () => {
  _clearCanonicalRootCache();
  const fixture = makeScratchFixture("worktree");
  const root = join(fixture, ".dsh-graph");
  try {
    init(root);
    assert.deepEqual(listWorktrees(root), [], "scratch 看板没有代码工作树，不得枚举真实 worktree");

    // 拒绝派发：scratch 不是 Git 仓库（回退修复后这里会**成功**在真实仓库建树 ⇒ 断言变红）
    assert.throws(
      () =>
        prepareAttemptWorktree(root, "g-363", "att-99", {
          enabled: true,
          baselineCommit: git(realMainWorktree(), ["rev-parse", "HEAD"]),
        }),
      /不是 Git 仓库|git 不可用/,
      "scratch 看板必须拒绝创建隔离工作树",
    );
    assert.ok(
      !realWorktreeRegistry().includes("g-363-att-99"),
      "真实仓库不得出现夹具 worktree 注册（污染可累积，必须钉死）",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// ============================================================================
// C. 不误伤：真正的 linked worktree 语义保持不变
// ============================================================================

test("g-363 不误伤：linked worktree 根（.worktrees/ 被 ignore）仍归一到主工作树", () => {
  _clearCanonicalRootCache();
  const base = mkdtempSync(join(tmpdir(), "g363-linked-"));
  try {
    const { mainDir, worktreeDir } = setupRepo(base);
    // 前置：worktree 根路径确实命中 .gitignore 的 `.worktrees/`，但它仍是项目根
    assert.match(git(mainDir, ["check-ignore", "-v", worktreeDir]) || "", /\.worktrees\//, "前置：worktree 根被忽略");
    assert.equal(isScratchWorkspace(worktreeDir), false, "工作树根不是 scratch");

    const info = discoverGitWorktree(worktreeDir);
    assert.ok(info, "linked worktree 仍是 git 工作树项目");
    assert.equal(info.isLinkedWorktree, true, "linked worktree 判定保留");
    const canonical = resolveCanonicalRoot(undefined, worktreeDir);
    assert.equal(canonical.mode, "canonicalized", "g-149 canonicalization 语义保留");
    assert.equal(canonical.root, join(mainDir, ".dsh-graph"), "归一到主工作树看板");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("g-363 边界：工作树内「已跟踪子目录」照旧归属该项目，「被忽略子目录」才隔离", () => {
  _clearCanonicalRootCache();
  const base = mkdtempSync(join(tmpdir(), "g363-boundary-"));
  try {
    const { mainDir, worktreeDir } = setupRepo(base);
    const tracked = join(worktreeDir, "src");
    const ignored = join(worktreeDir, "tmpdata");

    assert.equal(isScratchWorkspace(tracked), false, "被跟踪子目录不是 scratch");
    assert.equal(isScratchWorkspace(ignored), true, "被忽略子目录是 scratch");
    assert.equal(isScratchWorkspace(join(mainDir, "tmpdata")), true, "主工作树内的被忽略子目录同样是 scratch（g-338/g-344 出口）");

    // 已跟踪子目录：仍归一到该工作树所属仓库的主工作树（既有语义不变）
    const trackedCanonical = resolveCanonicalRoot(undefined, tracked);
    assert.equal(trackedCanonical.mode, "canonicalized", "被跟踪子目录仍按 linked worktree 归一");
    assert.equal(trackedCanonical.root, join(mainDir, ".dsh-graph"));

    // 被忽略子目录：独立项目，绝不归一
    const ignoredCanonical = resolveCanonicalRoot(undefined, ignored);
    assert.equal(ignoredCanonical.mode, "workspace-fallback", "被忽略子目录走 workspace-local");
    assert.equal(ignoredCanonical.root, join(ignored, ".dsh-graph"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ============================================================================
// D. 干净度探测：scratch 的 git status 说的是外层仓库，必须报 unknown
// ============================================================================

test("g-363：scratch 目录的干净度探测返回 unknown（不伪称干净）", () => {
  _clearCanonicalRootCache();
  const fixture = makeScratchFixture("clean");
  try {
    const r = detectWorkspaceCleanliness(fixture);
    assert.equal(r.clean, null, "scratch 的干净度不可判定");
    assert.ok("error" in r && (r as any).error.length > 0, "必须给出可读原因");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("g-363：非 scratch 路径的干净度探测语义不变（真 git 仓库仍报 clean/dirty）", () => {
  _clearCanonicalRootCache();
  const base = mkdtempSync(join(tmpdir(), "g363-clean-"));
  try {
    const dir = join(base, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    writeFileSync(join(dir, "README"), "x");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "init"]);
    assert.deepEqual(detectWorkspaceCleanliness(dir), { clean: true });
    writeFileSync(join(dir, "dirty.txt"), "x");
    const dirty = detectWorkspaceCleanliness(dir);
    assert.equal(dirty.clean, false, "真仓库的脏状态照旧报 dirty");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
