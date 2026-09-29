import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// g-374 F1 + F3-a：「完成摘要」tab 的客户端源契约（参照 g276-worktree-tab.test.ts 写法）。
// 覆盖判据 3/7：tab 已注册、zh/en 词条对称且 en 零 CJK、空态/截断标注存在、复用 MarkdownText、
// 未引入 markdown 渲染库、文件缺失/损坏不抛错；
// F3-a（负责人硬需求）额外钉住：tab **不再只读** —— 存在用户可直接点击的「更新摘要」动作，
// 点击即 POST /api/dsh-graph/refresh-results（零 CLI/会话指令），并有进行中/成功/空态/失败反馈。

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

/**
 * 在沙箱里加载 AttemptResults 组件（GoalMarkdown 用桩，便于断言复用与降级）。
 * F3-a：沙箱补齐 `React.useState` / `graphUrl` / `fetch`，并把 `renderResults(props)` 暴露出来
 * （state 跨多次调用保持，故「点击 → setState → 重渲染」可在测试里逐步观察）。
 */
function loadAttemptResults(ofLanguage: "zh" | "en" = "zh", fetchImpl?: (url: string, init: any) => any) {
  const h = (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children });
  const states: any[] = [];
  let cursor = 0;
  let currentProps: any = null;
  const sandbox: any = {};
  sandbox.h = h;
  sandbox.React = {
    createElement: h,
    useState: (init: any) => {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof init === "function" ? init() : init;
      const set = (v: any) => {
        states[i] = typeof v === "function" ? v(states[i]) : v;
        if (currentProps) sandbox.AttemptResults(currentProps);
      };
      return [states[i], set];
    },
  };
  sandbox.S = { btn: {}, meta: {}, modalSection: {}, modalH: {}, subCard: {} };
  sandbox.GoalMarkdown = (props: any) => h("div", { className: "dg-markdown-stub" }, String(props?.text ?? ""));
  sandbox.graphUrl = (path: string) => `http://test${path}?workspace=%2Fws`;
  const fetchCalls: Array<{ url: string; init: any }> = [];
  sandbox.fetch = (url: string, init: any) => {
    fetchCalls.push({ url, init });
    if (!fetchImpl) return Promise.reject(new Error("fetch 未被桩替换"));
    return fetchImpl(url, init);
  };
  const match = modalSource.match(/function AttemptResults\(props\) \{[\s\S]*?\n    \}/);
  if (!match) throw new Error("AttemptResults function definition not found in goal-modal.js");
  const { zh, en } = loadClientI18n();
  const dict = ofLanguage === "en" ? en : zh;
  sandbox.dgT = (key: string) => dict[key] ?? key;
  vm.runInNewContext(match[0] + ";\nthis.AttemptResults = AttemptResults;", sandbox);
  sandbox.renderResults = (props: any) => {
    currentProps = props;
    cursor = 0;
    return sandbox.AttemptResults(props);
  };
  sandbox.fetchCalls = fetchCalls;
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

/** 深度优先找出第一个满足谓词的 vnode（用于拿按钮的 onClick）。 */
function findVNode(node: any, pred: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findVNode(child, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (pred(node)) return node;
  return findVNode(node.children, pred);
}

const RESULT_KEYS = [
  "tab.results", "results.title", "results.summaryTitle", "results.attemptTitle",
  "results.noResults", "results.emptyBody", "results.truncatedBadge",
  "results.placeholderBadge", "results.degradedBadge", "results.generatedAt",
  "results.refresh", "results.refreshing", "results.refreshHint", "results.refreshOk",
  "results.refreshArchived", "results.refreshFirst", "results.refreshSkipped",
  "results.refreshFail", "results.refreshNoWorkspace", "results.omittedNote",
  "results.writeNote",
];

const SAMPLE_RESULTS = {
  summary: { attempt: null, body: "规范化摘要正文", generated_at: "2026-09-29T10:00:00.000+08:00", source: "history", truncated: false, placeholder: false, degraded: null },
  attempts: [
    { attempt: "att-002", body: "第二次输出", generated_at: "2026-09-29T12:00:00.000+08:00", source: "subagent/end", stop_reason: "completed", truncated: true, placeholder: false, degraded: null },
    { attempt: "att-001", body: "第一次输出", generated_at: "2026-09-29T11:00:00.000+08:00", source: "subagent/end", stop_reason: "completed", truncated: false, placeholder: true, degraded: null },
  ],
};

const tick = () => new Promise((r) => setTimeout(r, 0));

// ============================================================================
// 判据 7：i18n 词条对称 + en 零 CJK
// ============================================================================

test("g-374 F1/F3：完成摘要 tab 词条 zh/en 对称、en 零 CJK、label 逐字", () => {
  const { zh, en } = loadClientI18n();
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "zh/en 键集必须完全对称");
  for (const key of RESULT_KEYS) {
    assert.ok(zh[key] !== undefined, `zh 缺少 ${key}`);
    assert.ok(en[key] !== undefined, `en 缺少 ${key}`);
    assert.doesNotMatch(String(en[key]), /[\u3400-\u9fff]/, `en ${key} 含 CJK: ${en[key]}`);
    assert.ok(String(zh[key]).length > 0 && String(en[key]).length > 0, `${key} 必须为非空文案`);
  }
  // 负责人指定的 tab label：zh「完成摘要」/ en "Results"
  assert.ok(zh["tab.results"].includes("完成摘要"), "zh tab label 必须含「完成摘要」");
  assert.equal(en["tab.results"], "📝 Results", "en tab label");
  // 空态与截断标注必须存在且为非空文案
  assert.ok(zh["results.noResults"].length > 0 && en["results.noResults"].length > 0);
  assert.ok(zh["results.truncatedBadge"].includes("已截断"), "截断标注（UI 可见）");
  assert.ok(zh["results.placeholderBadge"].includes("占位"), "占位标注（UI 可见）");
  // F3-a：按钮与反馈文案（不再是「只读」措辞）
  assert.ok(zh["results.refresh"].includes("更新摘要"), "zh 按钮文案");
  assert.equal(en["results.refresh"], "🔄 Refresh summary", "en 按钮文案");
  assert.ok(!JSON.stringify(zh).includes("本页只读") && !JSON.stringify(en).includes("Read-only; files"), "不得再宣称只读");
});

// ============================================================================
// tab 注册 + 面板接线（源契约）
// ============================================================================

test("g-374 F1/F3：results tab 已注册并接入面板，且不破坏既有 tab 结构", () => {
  const resultsTabMatch = modalSource.match(/const resultsTab = \[([\s\S]*?)\];/);
  assert.ok(resultsTabMatch, "resultsTab 必须存在");
  assert.match(resultsTabMatch![1], /AttemptResults/, "resultsTab 必须渲染 AttemptResults");
  // F3-a：tab 必须把目标 id 与刷新回调传给组件（否则按钮无处可写、写完无法重载）
  assert.match(resultsTabMatch![1], /goalId:\s*props\.id/, "必须传入 goalId");
  assert.match(resultsTabMatch![1], /onRefreshed:\s*load/, "必须传入 onRefreshed（重载详情）");
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

test("g-374 F3-a：可写性契约——唯一网络请求在点击回调内、POST 到 refresh-results、复用 GoalMarkdown、不引入渲染库", () => {
  const match = modalSource.match(/function AttemptResults\(props\) \{([\s\S]*?)\n    \}/);
  assert.ok(match, "AttemptResults 函数体存在");
  const fnBody = match![1];
  // ① 请求必须只存在于 doRefresh 内（渲染/挂载不得发请求 ⇒ 无轮询、无隐式副作用）
  const head = fnBody.slice(0, fnBody.indexOf("const doRefresh"));
  assert.ok(head.length > 0, "必须存在 doRefresh 回调");
  assert.doesNotMatch(head, /fetch\(/, "点击之前不得有任何网络请求（组件不得自行轮询）");
  assert.equal((fnBody.match(/fetch\(/g) ?? []).length, 1, "函数体内恰有一处 fetch（即点击回调）");
  // F5：唯一出口收敛为 doRefresh 内的 post(payload) 小助手（全部请求都经它，杜绝第二处裸 fetch）。
  assert.match(fnBody, /const doRefresh = \(\) => \{[\s\S]*const post = \(payload\) => fetch\(graphUrl\("\/api\/dsh-graph\/refresh-results"\), \{[\s\S]*?\}\)/, "doRefresh 内发起请求");
  assert.match(fnBody, /method:\s*"POST"/, "必须是 POST");
  assert.match(fnBody, /graphUrl\("\/api\/dsh-graph\/refresh-results"\)/, "唯一路由：refresh-results");
  assert.match(fnBody, /body: JSON\.stringify\(payload\)/, "请求体由 payload 统一序列化");
  // F5 触发时机：点击先请 LLM（llm:true），失败/降级路径才走确定性写入 ⇒ 两条路都带目标 id。
  assert.match(fnBody, /post\(\{ goal: props\.goalId, llm: true \}\)/, "首选 LLM 详情摘要（llm:true）");
  assert.match(fnBody, /post\(\{ goal: props\.goalId \}\)/, "降级路径：确定性写入（无 llm 字段）");
  assert.match(fnBody, /results\.refreshCached/, "缓存命中反馈（历史未变不重复调 LLM）");
  assert.match(fnBody, /results\.refreshPending/, "等待专用摘要子代理反馈");
  assert.match(fnBody, /results\.refreshFallbackNote/, "LLM 失败 → 显式提示已回退机器摘要");
  assert.match(fnBody, /if \(!graphUrl\("\/api\/dsh-graph\/refresh-results"\)\) \{\s*setNote\(\{ kind: "err", text: dgT\("results\.refreshNoWorkspace"\)/, "未知 workspace 时 fail closed");
  // ② 有本地状态 + 可见反馈（进行中/成功/归档名/跳过/失败）
  assert.match(fnBody, /useState\(false\)/, "busy 状态");
  assert.match(fnBody, /useState\(null\)/, "note 状态");
  assert.match(fnBody, /dgT\("results\.refreshing"\)/, "进行中反馈");
  assert.match(fnBody, /dgT\("results\.refreshOk"\)/, "成功反馈");
  assert.match(fnBody, /dgT\("results\.refreshArchived"\)/, "归档文件名反馈");
  assert.match(fnBody, /dgT\("results\.refreshSkipped"\)/, "跳过反馈（来源为空）");
  assert.match(fnBody, /dgT\("results\.refreshFail"\)/, "失败反馈");
  assert.match(fnBody, /props\.onRefreshed/, "成功后重载详情（展示新摘要）");
  // ③ 展示面未回退
  assert.match(fnBody, /h\(GoalMarkdown, \{ text: r\.body \}\)/, "必须复用仓库内 GoalMarkdown（MarkdownText）");
  assert.match(fnBody, /disabled: busy \? true : undefined/, "进行中禁用按钮（防重复提交）");
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

test("g-374 F1/F3：AttemptResults 渲染 attempt 倒序内容 + 写入时间 + 截断标注 + 可点击的更新按钮", () => {
  const sandbox = loadAttemptResults("zh");
  const vnode = sandbox.renderResults({ results: SAMPLE_RESULTS, goalId: "g-001" });
  const texts = extractAllText(vnode);
  assert.ok(texts.some((t) => t.includes("att-002")), "attempt id 必须可见");
  assert.ok(texts.some((t) => t.includes("att-001")), "attempt id 必须可见");
  assert.ok(texts.some((t) => t.includes("第二次输出")), "正文经 GoalMarkdown 渲染");
  assert.ok(texts.some((t) => t.includes("2026-09-29T12:00:00.000+08:00")), "写入时间必须可见");
  assert.ok(texts.some((t) => t.includes("已截断")), "截断标注必须可见");
  assert.ok(texts.some((t) => t.includes("占位")), "占位标注必须可见");
  assert.ok(texts.some((t) => t.includes("规范化摘要")), "results.md（F2 summary）优先展示");
  assert.ok(texts.some((t) => t.includes("本页可写")), "F3-a：覆盖式「可写」说明");
  // F3-a：渲染出的必须是一个真实可点的按钮（而不是纯文本说明）
  const button = findVNode(vnode, (n) => n.type === "button");
  assert.ok(button, "必须渲染 button 元素");
  assert.equal(typeof button.props.onClick, "function", "按钮必须有 onClick");
  assert.ok(button.props.title && String(button.props.title).length > 0, "按钮必须有 title 提示（无需 CLI/会话指令）");
  assert.ok(texts.some((t) => t.includes("更新摘要")), "按钮文案可见");
});

test("g-374 F3-a：点击更新摘要 → 恰好一次 POST + 进行中/成功反馈 + 归档文件名（无请求发生在点击前）", async () => {
  const sandbox = loadAttemptResults("zh", () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true, written: true, file: "/ws/.dsh-graph/versions/v/goals/g-001/results.md",
        archive: "/ws/.dsh-graph/versions/v/goals/g-001/results-archive-20260101T010101.md",
        bytes: 1234, truncated: false, reason: null, generated_at: "2026-09-29T10:00:00.000+08:00",
      }),
    }));
  const render = () => sandbox.renderResults({ results: SAMPLE_RESULTS, goalId: "g-001" });
  const v1 = render();
  assert.equal(sandbox.fetchCalls.length, 0, "点击前不得有任何请求（无轮询）");

  const button = findVNode(v1, (n) => n.type === "button");
  button.props.onClick({ stopPropagation() {} });

  // 进行中：立刻可见「正在重写…」且按钮禁用
  const busyV = render();
  assert.ok(extractAllText(busyV).some((t) => t.includes("正在重写")), "进行中反馈必须立即可见");
  assert.equal(findVNode(busyV, (n) => n.type === "button").props.disabled, true, "进行中禁用按钮");

  await tick();
  await tick();
  const doneV = render();
  assert.equal(sandbox.fetchCalls.length, 1, "恰好一次 POST");
  assert.match(sandbox.fetchCalls[0].url, /\/api\/dsh-graph\/refresh-results\?workspace=/, "URL 走 graphUrl（带 workspace）");
  assert.equal(sandbox.fetchCalls[0].init.method, "POST");
  assert.equal(JSON.parse(sandbox.fetchCalls[0].init.body).goal, "g-001", "请求体带目标 id");
  const doneTexts = extractAllText(doneV);
  assert.ok(doneTexts.some((t) => t.includes("摘要已更新")), "成功反馈必须可见");
  assert.ok(doneTexts.some((t) => t.includes("results-archive-20260101T010101.md")), "归档文件名必须可见（可追溯）");
  assert.ok(!doneTexts.some((t) => t.includes("20260101T010101.md") && t.includes("/ws/")), "不得把绝对路径糊到 UI");
  assert.equal(findVNode(doneV, (n) => n.type === "button").props.disabled, undefined, "结束后恢复可点");
});

test("g-374 F3-a：空态（来源为空）与失败都必须有可见反馈，且不抛错", async () => {
  // ① 业务跳过：HTTP 200 + ok:false + reason ⇒ 明确说明「未生成」，而不是假装成功
  const skip = loadAttemptResults("zh", () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, written: false, skipped: true, reason: "no-source" }) }));
  const sv = skip.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-002" });
  findVNode(sv, (n) => n.type === "button").props.onClick({ stopPropagation() {} });
  await tick(); await tick();
  const skipTexts = extractAllText(skip.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-002" }));
  assert.ok(skipTexts.some((t) => t.includes("未生成") && t.includes("no-source")), "跳过原因必须可见");
  assert.ok(skipTexts.some((t) => t.includes("暂无完成摘要")), "同时保留空态文案");

  // ② 真失败：HTTP 500 + error ⇒ 可见失败反馈（含原因），组件不抛错
  const bad = loadAttemptResults("zh", () =>
    Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "boom" }) }));
  const bv = bad.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-003" });
  assert.doesNotThrow(() => findVNode(bv, (n) => n.type === "button").props.onClick({ stopPropagation() {} }));
  await tick(); await tick();
  const badTexts = extractAllText(bad.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-003" }));
  assert.ok(badTexts.some((t) => t.includes("更新失败") && t.includes("boom")), "失败原因必须可见");

  // ③ 网络异常（fetch reject）⇒ 同样降级为可见反馈，绝不抛穿
  const net = loadAttemptResults("zh", () => Promise.reject(new Error("offline")));
  const nv = net.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-004" });
  findVNode(nv, (n) => n.type === "button").props.onClick({ stopPropagation() {} });
  await tick(); await tick();
  const netTexts = extractAllText(net.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-004" }));
  assert.ok(netTexts.some((t) => t.includes("更新失败") && t.includes("offline")), "网络异常必须可见");

  // ④ 未知 workspace（graphUrl 返回 null）⇒ fail closed，不调用 fetch
  const noWs = loadAttemptResults("zh", () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  noWs.graphUrl = () => null;
  const wv = noWs.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-005" });
  findVNode(wv, (n) => n.type === "button").props.onClick({ stopPropagation() {} });
  await tick();
  assert.equal(noWs.fetchCalls.length, 0, "未知 workspace 不得发请求");
  assert.ok(extractAllText(noWs.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-005" }))
    .some((t) => t.includes("未关联 workspace")), "必须给出可见提示");
});

test("g-374 F1/F3：空态与降级——无结果/缺字段/降级标记/总量削减均不抛错并给出可见文案", () => {
  const sandbox = loadAttemptResults("zh");
  // 1. 空态
  assert.ok(extractAllText(sandbox.renderResults({ results: { summary: null, attempts: [] }, goalId: "g-1" }))
    .some((t) => t.includes("暂无完成摘要")));
  // 2. props 完全缺失（渲染期解引用保护）
  assert.ok(extractAllText(sandbox.renderResults({})).some((t) => t.includes("暂无完成摘要")));
  // 3. results 为 null / attempts 非数组（损坏数据不抛错）
  assert.doesNotThrow(() => sandbox.renderResults({ results: null }));
  assert.doesNotThrow(() => sandbox.renderResults({ results: { attempts: "corrupt" } }));
  // 4. 单条缺 body ⇒ 可见「无正文」；缺 generated_at ⇒ 不崩
  const degraded = sandbox.renderResults({ results: { attempts: [{ attempt: "att-009", degraded: "oversized", text: "x" }] } });
  const dt = extractAllText(degraded);
  assert.ok(dt.some((t) => t.includes("att-009")));
  assert.ok(dt.some((t) => t.includes("无正文")), "缺正文时可见降级文案");
  assert.ok(dt.some((t) => t.includes("降级读取") && t.includes("oversized")), "降级原因可见");
  // 5. 总量削减（F1 复核注记④）⇒ 可见计数，不静默丢数据
  const omitted = extractAllText(sandbox.renderResults({ results: { summary: null, attempts: [], omitted: 3 }, goalId: "g-1" }));
  assert.ok(omitted.some((t) => t.includes("未下发") && t.includes("3")), "总量削减必须可见");
  assert.ok(!extractAllText(sandbox.renderResults({ results: { summary: null, attempts: [], omitted: 0 } }))
    .some((t) => t.includes("未下发")), "无削减时不显示该行");
  // 6. en 输出零 CJK
  const en = loadAttemptResults("en");
  const enTexts = extractAllText(en.renderResults({
    results: { summary: null, attempts: [{ attempt: "att-001", body: "output", generated_at: "T", truncated: true, placeholder: true }], omitted: 2 },
    goalId: "g-1",
  }));
  for (const t of enTexts) assert.doesNotMatch(t, /[\u3400-\u9fff]/, `en 输出含 CJK: ${t}`);
  const enEmpty = extractAllText(en.renderResults({ results: { attempts: [] } }));
  for (const t of enEmpty) assert.doesNotMatch(t, /[\u3400-\u9fff]/, `en 空态含 CJK: ${t}`);
});

// ============================================================================
// bundle 已重建（改源码必须先构建）
// ============================================================================

test("g-374 F1/F3：dist/lib/client.js 已包含重建后的 results tab 代码", () => {
  assert.match(bundleSource, /function AttemptResults\(props\) \{/, "bundle 含 AttemptResults");
  assert.match(bundleSource, /const resultsTab = \[/, "bundle 含 resultsTab");
  assert.match(bundleSource, /dgT\("tab\.results"\)/, "bundle 含 tab label");
  assert.match(bundleSource, /'tab\.results': '📝 完成摘要'/, "bundle 含 zh 词条");
  // F3-a：重建后的 bundle 必须含刷新动作与路由（否则线上点了没反应）
  assert.match(bundleSource, /\/api\/dsh-graph\/refresh-results/, "bundle 含刷新路由");
  assert.match(bundleSource, /'results\.refresh': '🔄 更新摘要'/, "bundle 含 zh 按钮词条");
});
