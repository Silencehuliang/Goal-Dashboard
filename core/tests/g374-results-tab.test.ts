import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// g-374 F1：只读「完成摘要」tab 的客户端源契约（参照 g276-worktree-tab.test.ts 写法）。
// 覆盖判据 7：tab 已注册、zh/en 词条对称且 en 零 CJK、空态/截断标注存在、复用 MarkdownText、
// 未引入 markdown 渲染库、文件缺失/损坏不抛错。

const hostRoot = join(import.meta.dirname, "../../dsh-graph-host");
const i18nSource = readFileSync(join(hostRoot, "lib/client/i18n.js"), "utf8");
const modalSource = readFileSync(join(hostRoot, "lib/client/goal-modal.js"), "utf8");
const distRoot = join(import.meta.dirname, "../../dist");
const bundleSource = readFileSync(join(distRoot, "lib/client.js"), "utf8");

function loadClientI18n() {
  const sandbox: any = { React: {} };
  vm.runInNewContext(i18nSource + "; this.zh = zh; this.en = en;", sandbox);
  return { zh: sandbox.zh, en: sandbox.en };
}

/** 在沙箱里加载 AttemptResults 组件（GoalMarkdown 用桩，便于断言复用与降级）。 */
function loadAttemptResults(ofLanguage: "zh" | "en" = "zh") {
  const h = (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children });
  const sandbox: any = {
    React: { createElement: h },
    h,
    S: { btn: {}, meta: {}, modalSection: {}, modalH: {}, subCard: {} },
    GoalMarkdown: (props: any) => h("div", { className: "dg-markdown-stub" }, String(props?.text ?? "")),
  };
  const match = modalSource.match(/function AttemptResults\(props\) \{[\s\S]*?\n    \}/);
  if (!match) throw new Error("AttemptResults function definition not found in goal-modal.js");
  const { zh, en } = loadClientI18n();
  const dict = ofLanguage === "en" ? en : zh;
  sandbox.dgT = (key: string) => dict[key] ?? key;
  vm.runInNewContext(match[0] + ";\nthis.AttemptResults = AttemptResults;", sandbox);
  return sandbox;
}

function extractAllText(node: any): string[] {
  if (!node) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(extractAllText);
  // 函数型组件（如 GoalMarkdown 桩）就地渲染，才能看到其内部文本
  if (typeof node.type === "function") {
    try { return extractAllText(node.type(node.props)); } catch { return []; }
  }
  if (Array.isArray(node.children)) return node.children.flatMap(extractAllText);
  return [];
}

const RESULT_KEYS = [
  "tab.results", "results.title", "results.summaryTitle", "results.attemptTitle",
  "results.noResults", "results.emptyBody", "results.truncatedBadge",
  "results.placeholderBadge", "results.degradedBadge", "results.generatedAt",
  "results.readOnlyNote",
];

// ============================================================================
// 判据 7：i18n 词条对称 + en 零 CJK
// ============================================================================

test("g-374 F1：完成摘要 tab 词条 zh/en 对称、en 零 CJK、label 逐字", () => {
  const { zh, en } = loadClientI18n();
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "zh/en 键集必须完全对称");
  for (const key of RESULT_KEYS) {
    assert.ok(zh[key] !== undefined, `zh 缺少 ${key}`);
    assert.ok(en[key] !== undefined, `en 缺少 ${key}`);
    assert.doesNotMatch(String(en[key]), /[\u3400-\u9fff]/, `en ${key} 含 CJK: ${en[key]}`);
    assert.doesNotMatch(String(zh[key]), /[\u3400-\u9fff]{0,0}x/, "占位");
  }
  // 负责人指定的 tab label：zh「完成摘要」/ en "Results"
  assert.ok(zh["tab.results"].includes("完成摘要"), "zh tab label 必须含「完成摘要」");
  assert.equal(en["tab.results"], "📝 Results", "en tab label");
  // 空态与截断标注必须存在且为非空文案
  assert.ok(zh["results.noResults"].length > 0 && en["results.noResults"].length > 0);
  assert.ok(zh["results.truncatedBadge"].includes("已截断"), "截断标注（UI 可见）");
  assert.ok(zh["results.placeholderBadge"].includes("占位"), "占位标注（UI 可见）");
});

// ============================================================================
// tab 注册 + 面板接线（源契约）
// ============================================================================

test("g-374 F1：results tab 已注册并接入面板，且不破坏既有 tab 结构", () => {
  const resultsTabMatch = modalSource.match(/const resultsTab = \[([\s\S]*?)\];/);
  assert.ok(resultsTabMatch, "resultsTab 必须存在");
  assert.match(resultsTabMatch![1], /AttemptResults/, "resultsTab 必须渲染 AttemptResults");
  assert.match(modalSource, /setTab\("results"\)/, "setTab('results') onClick 存在");
  assert.match(modalSource, /dgT\("tab\.results"\)/, "tab label 走 dgT('tab.results')");
  assert.match(modalSource, /tab === "results"\s*\?\s*resultsTab/, "面板在 tab==='results' 时渲染 resultsTab");
  // 既有四个 tab 未被破坏
  assert.match(modalSource, /tab === "detail"\s*\?\s*detailTab/);
  assert.match(modalSource, /tab === "worktree"\s*\?\s*worktreeTab/);
  assert.match(modalSource, /tab === "context"\s*\?\s*contextTab/);
  // tab 状态注释已含 results
  assert.match(modalSource, /useState\("detail"\);\s*\/\/[^\n]*"results"/);
});

test("g-374 F1：只读性——组件不发任何网络请求、不引入渲染库、复用 GoalMarkdown", () => {
  const match = modalSource.match(/function AttemptResults\(props\) \{([\s\S]*?)\n    \}/);
  assert.ok(match, "AttemptResults 函数体存在");
  const fnBody = match![1];
  assert.doesNotMatch(fnBody, /fetch\(/, "只读 tab 不得新增任何网络请求");
  assert.doesNotMatch(fnBody, /useState\(/, "无本地状态（纯只读投影）");
  assert.match(fnBody, /h\(GoalMarkdown, \{ text: r\.body \}\)/, "必须复用仓库内 GoalMarkdown（MarkdownText）");
  // 仓库依赖面不得引入 markdown 渲染库
  const pkg = JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8"));
  const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  for (const lib of ["marked", "markdown-it", "react-markdown", "remark", "showdown"]) {
    assert.ok(!deps.includes(lib), `不得引入渲染库：${lib}`);
  }
  for (const lib of ["marked", "markdown-it", "react-markdown", "showdown"]) {
    assert.ok(!new RegExp(`from ["']${lib}["']`).test(bundleSource), `bundle 不得引用 ${lib}`);
  }
});

// ============================================================================
// 渲染行为（vm 抠函数）
// ============================================================================

test("g-374 F1：AttemptResults 渲染 attempt 倒序内容 + 写入时间 + 截断标注", () => {
  const sandbox = loadAttemptResults("zh");
  const vnode = sandbox.AttemptResults({
    results: {
      summary: { attempt: null, body: "规范化摘要正文", generated_at: "2026-09-29T10:00:00.000+08:00", source: "manual", truncated: false, placeholder: false, degraded: null },
      attempts: [
        { attempt: "att-002", body: "第二次输出", generated_at: "2026-09-29T12:00:00.000+08:00", source: "subagent/end", stop_reason: "completed", truncated: true, placeholder: false, degraded: null },
        { attempt: "att-001", body: "第一次输出", generated_at: "2026-09-29T11:00:00.000+08:00", source: "subagent/end", stop_reason: "completed", truncated: false, placeholder: true, degraded: null },
      ],
    },
  });
  const texts = extractAllText(vnode);
  assert.ok(texts.some((t) => t.includes("att-002")), "attempt id 必须可见");
  assert.ok(texts.some((t) => t.includes("att-001")), "attempt id 必须可见");
  assert.ok(texts.some((t) => t.includes("第二次输出")), "正文经 GoalMarkdown 渲染");
  assert.ok(texts.some((t) => t.includes("2026-09-29T12:00:00.000+08:00")), "写入时间必须可见");
  assert.ok(texts.some((t) => t.includes("已截断")), "截断标注必须可见");
  assert.ok(texts.some((t) => t.includes("占位")), "占位标注必须可见");
  assert.ok(texts.some((t) => t.includes("规范化摘要")), "results.md（F2 summary）优先展示");
  assert.ok(texts.some((t) => t.includes("本页只读")), "覆盖式只读说明");
});

test("g-374 F1：空态与降级——无结果/缺字段/降级标记均不抛错并给出可见文案", () => {
  const sandbox = loadAttemptResults("zh");
  // 1. 空态
  assert.ok(extractAllText(sandbox.AttemptResults({ results: { summary: null, attempts: [] } }))
    .some((t) => t.includes("暂无完成摘要")));
  // 2. props 完全缺失（渲染期解引用保护）
  assert.ok(extractAllText(sandbox.AttemptResults({})).some((t) => t.includes("暂无完成摘要")));
  // 3. results 为 null / attempts 非数组（损坏数据不抛错）
  assert.doesNotThrow(() => sandbox.AttemptResults({ results: null }));
  assert.doesNotThrow(() => sandbox.AttemptResults({ results: { attempts: "corrupt" } }));
  // 4. 单条缺 body ⇒ 可见「无正文」；缺 generated_at ⇒ 不崩
  const degraded = sandbox.AttemptResults({ results: { attempts: [{ attempt: "att-009", degraded: "oversized", text: "x" }] } });
  const dt = extractAllText(degraded);
  assert.ok(dt.some((t) => t.includes("att-009")));
  assert.ok(dt.some((t) => t.includes("无正文")), "缺正文时可见降级文案");
  assert.ok(dt.some((t) => t.includes("降级读取") && t.includes("oversized")), "降级原因可见");
  // 5. en 输出零 CJK
  const en = loadAttemptResults("en");
  const enTexts = extractAllText(en.AttemptResults({
    results: { summary: null, attempts: [{ attempt: "att-001", body: "output", generated_at: "T", truncated: true, placeholder: true }] },
  }));
  for (const t of enTexts) assert.doesNotMatch(t, /[\u3400-\u9fff]/, `en 输出含 CJK: ${t}`);
  const enEmpty = extractAllText(en.AttemptResults({ results: { attempts: [] } }));
  for (const t of enEmpty) assert.doesNotMatch(t, /[\u3400-\u9fff]/, `en 空态含 CJK: ${t}`);
});

// ============================================================================
// bundle 已重建（改源码必须先构建）
// ============================================================================

test("g-374 F1：dist/lib/client.js 已包含重建后的 results tab 代码", () => {
  assert.match(bundleSource, /function AttemptResults\(props\) \{/, "bundle 含 AttemptResults");
  assert.match(bundleSource, /const resultsTab = \[/, "bundle 含 resultsTab");
  assert.match(bundleSource, /dgT\("tab\.results"\)/, "bundle 含 tab label");
  assert.match(bundleSource, /'tab\.results': '📝 完成摘要'/, "bundle 含 zh 词条");
});
