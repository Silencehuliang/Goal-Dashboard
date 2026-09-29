import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  init,
  createGoal,
  setCriteria,
  startAttempt,
  bindAttemptChild,
  readGoalBinding,
  abandonAttempt,
  unbindGoalChild,
  goalDetail,
  goalResults,
  findGoalFile,
  writeAttemptResults,
  attemptResultsFile,
  ATTEMPT_RESULTS_MAX_BYTES,
  ATTEMPT_RESULTS_READ_MAX_BYTES,
  ATTEMPT_RESULTS_SOURCES,
} from "../ops.ts";
import { readEvents } from "../events.ts";

// g-374 F1：attempt 完成摘要的落盘契约（路径/头字段/事件先行/原子写/截断/占位/开放 source）。
// 严格对照目标判据 2、3，以及「复核逐字核」的落盘契约。

const OVERWRITE_NOTE = "本文件由机器生成，下次写入整体覆盖";

function setup() {
  const ws = mkdtempSync(join(tmpdir(), "dsh-graph-g374-"));
  const root = join(ws, ".dsh-graph");
  init(root);
  const goal = createGoal(root, { title: "完成摘要", version: "v-test", actor: "human:gui" });
  setCriteria(root, goal, ["判据 1"], "human:gui");
  const attempt = startAttempt(root, goal, { executor: "agent:exec", actor: "human:gui" });
  const goalFile = findGoalFile(root, goal);
  return { ws, root, goal, attempt, goalFile, dir: dirname(goalFile) };
}

function resultsEvents(root: string, name: string) {
  return readEvents(root).filter((e) => e.event === name);
}

// ============================================================================
// 判据 2：自动落盘——路径命名、文件头字段、事件、无半文件
// ============================================================================

test("g-374 F1：正常输出落盘——<goalDir>/results-att-001.md 命名 + 头字段齐全 + 事件先行 + 无半文件", () => {
  const { root, goal, attempt, dir, goalFile } = setup();
  assert.equal(attempt, "att-001", "attempt id 与文件命名的一一映射前提");

  const res = writeAttemptResults(root, {
    goal, attempt, source: "subagent/end", childId: "child-abc",
    stopReason: "completed", text: "第一行\n第二行", actor: "supervisor:sess-1",
  });

  assert.equal(res.written, true);
  assert.equal(res.skipped, false);
  assert.equal(res.placeholder, false);
  assert.equal(res.truncated, false);
  assert.equal(res.file, join(dir, "results-att-001.md"), "命名写死为 results-<attempt>.md");
  assert.equal(res.file, attemptResultsFile(goalFile, attempt), "attemptResultsFile 为唯一真源");
  assert.ok(existsSync(res.file), "约定文件必须出现");

  const raw = readFileSync(res.file, "utf8");
  assert.match(raw, /^<!-- dsh-graph:results:begin -->/, "机器头起始标记");
  // 逐字核：文件头必备字段
  for (const field of [
    "generated_at: ", `goal: ${goal}`, `attempt: ${attempt}`, "child_id: child-abc",
    "source: subagent/end", "stop_reason: completed", "truncated: false",
  ]) {
    assert.ok(raw.includes(field), `文件头缺字段：${field}`);
  }
  assert.ok(raw.includes("<!-- dsh-graph:results:end -->"), "机器头结束标记");
  assert.ok(raw.includes(OVERWRITE_NOTE), "必须含覆盖式说明（逐字）");
  assert.ok(raw.includes("第一行\n第二行"), "正文保留子代理输出");
  assert.ok(raw.includes(`## ${attempt} 完成摘要`), "正文带 attempt 小节");

  // 事件先行：attempt.results_written 载荷完整
  const evs = resultsEvents(root, "attempt.results_written");
  assert.equal(evs.length, 1, "每次写入追加一条事件");
  const d = evs[0].details;
  assert.equal(evs[0].goal, goal);
  assert.equal(d.attempt, attempt);
  assert.equal(d.child_id, "child-abc");
  assert.equal(d.source, "subagent/end");
  assert.equal(d.stop_reason, "completed");
  assert.equal(d.bytes, Buffer.byteLength("第一行\n第二行", "utf8"));
  assert.equal(d.truncated, false);
  assert.equal(d.placeholder, false);
  assert.equal(d.reason, null);
  assert.equal(d.overwrite, false);
  assert.equal(d.file, res.file);

  // 原子写不留半文件（F1 复核 must-fix①：原断言只查 `.tmp-*` 前缀，而 atomicWrite 的真实临时名是
  // `<目标文件>.tmp.<pid>`（core/transaction.ts:180）⇒ 该断言恒真（vacuous）。这里改为钉住**真实**
  // 临时名，并保留「任何 *.tmp.* 残留」的广义检查；反恒真对照见下方「断言非恒真」用例。
  const realTmp = `${res.file}.tmp.${process.pid}`;
  assert.equal(existsSync(realTmp), false, `原子写不得残留真实临时文件 ${basename(realTmp)}`);
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes(".tmp.")), [], "不得残留任何 *.tmp.* 半文件");
});

test("g-374 F1：原子写残留断言**非恒真**（must-fix① 反恒真对照：造出真实临时名即必红）", () => {
  const { root, goal, attempt, dir } = setup();
  const res = writeAttemptResults(root, { goal, attempt, source: "subagent/end", stopReason: "completed", text: "x" });
  const realTmp = `${res.file}.tmp.${process.pid}`;
  // 人为造出「atomicWrite 会留下的那种半文件」，判定函数必须能看见它（否则断言与实现不同名 = 恒真）。
  writeFileSync(realTmp, "半文件");
  try {
    assert.equal(existsSync(realTmp), true);
    assert.notDeepEqual(readdirSync(dir).filter((n) => n.includes(".tmp.")), [], "残留检查必须能命中真实临时名");
    assert.ok(readdirSync(dir).includes(basename(realTmp)), "临时名写法与 atomicWrite 逐字一致");
  } finally {
    rmSync(realTmp, { force: true });
  }
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes(".tmp.")), [], "对照后必须清干净");
});

test("g-374 F1：goalDetail 新增只读 results 字段（不改 board 缓存；attempt 倒序）", () => {
  const { root, goal, attempt } = setup();
  writeAttemptResults(root, { goal, attempt, source: "subagent/end", stopReason: "completed", text: "输出 A" });

  const detail = goalDetail(root, goal);
  assert.ok(detail.results, "goalDetail 必须下发 results 字段");
  assert.equal(detail.results.summary, null, "F1 阶段无 results.md ⇒ summary 为 null");
  assert.equal(detail.results.attempts.length, 1);
  assert.equal(detail.results.attempts[0].attempt, attempt);
  assert.equal(detail.results.attempts[0].source, "subagent/end");
  assert.equal(detail.results.attempts[0].placeholder, false);
  assert.ok(detail.results.attempts[0].body.includes("输出 A"));
});

// ============================================================================
// 判据 3：三类占位可区分（都写文件 + 事件；禁空文件、禁静默跳过、禁抛错）
// ============================================================================

test("g-374 F1：占位①child_error（无子代理）——写文件 + 事件，不写空文件", () => {
  const { root, goal, attempt, dir } = setup();
  const res = writeAttemptResults(root, {
    goal, attempt, source: "child_error", childId: null,
    reason: "child-error: 无可用 provider", actor: "human:gui",
  });
  assert.equal(res.written, true);
  assert.equal(res.placeholder, true);
  const raw = readFileSync(join(dir, "results-att-001.md"), "utf8");
  assert.ok(raw.length > 0, "禁止空文件");
  assert.ok(raw.includes("source: child_error"));
  assert.ok(raw.includes("placeholder: true"));
  assert.ok(raw.includes("占位"), "文件内可见占位标记");
  assert.ok(raw.includes("child-error: 无可用 provider"));
  const evs = resultsEvents(root, "attempt.results_written");
  assert.equal(evs.length, 1);
  assert.equal(evs[0].details.source, "child_error");
  assert.equal(evs[0].details.placeholder, true);
  assert.equal(evs[0].details.reason, "child-error: 无可用 provider");
});

test("g-374 F1：占位②stopReason 异常 / 字段缺失——reason 可区分且 stop_reason 原样记录", () => {
  // ②-a：字段缺失（无 text）且 stopReason=error
  {
    const { root, goal, attempt, dir } = setup();
    const res = writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "error", text: "" });
    assert.equal(res.written, true);
    assert.equal(res.placeholder, true);
    assert.equal(res.reason, "stop-error");
    const raw = readFileSync(join(dir, "results-att-001.md"), "utf8");
    assert.ok(raw.includes("source: subagent/end"));
    assert.ok(raw.includes("reason: stop-error"));
    assert.ok(raw.includes("stop_reason: error"));
    assert.equal(resultsEvents(root, "attempt.results_written")[0].details.reason, "stop-error");
  }
  // ②-b：有部分输出但终止异常 ⇒ 保留输出 + 可见异常标注（不丢内容）
  {
    const { root, goal, attempt, dir } = setup();
    const res = writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "aborted", text: "半截输出" });
    assert.equal(res.placeholder, false, "有文本 ⇒ 不是占位");
    const raw = readFileSync(join(dir, "results-att-001.md"), "utf8");
    assert.ok(raw.includes("stop_reason: aborted"));
    assert.ok(raw.includes("半截输出"));
    assert.ok(raw.includes("终止异常"), "异常终止必须在文件内可见");
    assert.equal(resultsEvents(root, "attempt.results_written")[0].details.stop_reason, "aborted");
  }
  // ②-c：stopReason=completed 但无文本 ⇒ no-output（与 ②-a 可区分）
  {
    const { root, goal, attempt } = setup();
    const res = writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "completed", text: "   " });
    assert.equal(res.placeholder, true);
    assert.equal(res.reason, "no-output");
  }
});

test("g-374 F1：占位③abandon——放弃分支写 source=abandon 占位 + 事件", () => {
  const { root, goal, attempt, dir } = setup();
  bindAttemptChild(root, goal, attempt, "child-abandon", "human:gui", "sess-super");
  const out = abandonAttempt(root, goal, {
    actor: "human:gui", attempt, reason: "陈旧任务", liveCheck: () => "gone",
  });
  assert.equal(out.abandoned, true);
  const file = join(dir, `results-${attempt}.md`);
  assert.ok(existsSync(file), "abandon 必须落盘占位文件");
  const raw = readFileSync(file, "utf8");
  assert.ok(raw.includes("source: abandon"));
  assert.ok(raw.includes("child_id: child-abandon"), "解锁前捕获的 child_id 必须写入文件头");
  assert.ok(raw.includes("placeholder: true"));
  const evs = resultsEvents(root, "attempt.results_written").filter((e) => e.goal === goal);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].details.source, "abandon");
  assert.equal(evs[0].details.attempt, attempt);
});

test("g-374 F1：占位③detach（含 superseded）——解绑分支写 source=detach 占位", () => {
  const { root, goal, attempt, dir } = setup();
  bindAttemptChild(root, goal, attempt, "child-detach", "human:gui", "sess-super");
  const binding = readGoalBinding(root, goal);
  assert.ok(binding, "绑定必须存在");
  const out = unbindGoalChild(root, goal, {
    actor: "human:gui", attempt, token: binding!.binding_token, liveCheck: () => "gone",
  });
  assert.equal(out.detached, true);
  const raw = readFileSync(join(dir, `results-${attempt}.md`), "utf8");
  assert.ok(raw.includes("source: detach"));
  assert.ok(raw.includes("child_id: child-detach"));
  const evs = resultsEvents(root, "attempt.results_written").filter((e) => e.goal === goal);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].details.source, "detach");
  assert.equal(evs[0].details.reason, "detach");
});

test("g-374 F1：占位不得覆盖已截获的真实输出（keepExisting ⇒ 事件留痕、文件不动）", () => {
  const { root, goal, attempt, dir } = setup();
  const file = join(dir, `results-${attempt}.md`);
  writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "completed", text: "真实输出不可丢" });
  const before = readFileSync(file, "utf8");

  const res = writeAttemptResults(root, { goal, attempt, source: "abandon", childId: "c1", reason: "abandoned: x", keepExisting: true });
  assert.equal(res.written, false);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, "existing-results-kept");
  assert.equal(readFileSync(file, "utf8"), before, "已截获输出必须逐字保留");
  const skipped = resultsEvents(root, "attempt.results_skipped");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].details.reason, "existing-results-kept");
});

// ============================================================================
// 截断：默认 64 KiB，按 UTF-8 字节且不切坏多字节字符；文件头 + 事件双标注
// ============================================================================

test("g-374 F1：截断——默认 64 KiB、不切坏多字节字符、文件头与事件双标注、无半文件", () => {
  assert.equal(ATTEMPT_RESULTS_MAX_BYTES, 64 * 1024, "截断默认值写死为 64 KiB");
  const { root, goal, attempt, dir } = setup();
  const body = "中".repeat(5000); // 3 字节/字 ⇒ 15000 字节
  assert.ok(Buffer.byteLength(body, "utf8") > 2000);

  const res = writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "completed", text: body, maxBytes: 2000 });
  assert.equal(res.truncated, true);
  assert.equal(res.bytes, Buffer.byteLength(readFileSync(join(dir, `results-${attempt}.md`), "utf8").split("## " + attempt + " 完成摘要\n\n")[1].trimEnd(), "utf8"));
  assert.ok(res.original_bytes > 2000);

  const raw = readFileSync(join(dir, `results-${attempt}.md`), "utf8");
  assert.ok(raw.includes("truncated: true"), "文件头标注截断");
  assert.ok(raw.includes("已截断"), "文件内可见截断标注（UI 要能看到）");
  assert.ok(!raw.includes("\uFFFD"), "不得切坏多字节字符");
  const ev = resultsEvents(root, "attempt.results_written")[0].details;
  assert.equal(ev.truncated, true, "事件标注截断");
  assert.equal(ev.original_bytes, Buffer.byteLength(body, "utf8"));
  // must-fix①：与实现同名的真实临时名 + 广义残留检查（原 `.tmp-*` 前缀断言与实际命名不符 = 恒真）
  assert.equal(existsSync(`${join(dir, `results-${attempt}.md`)}.tmp.${process.pid}`), false, "不得残留真实临时文件");
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes(".tmp.")), [], "不得残留任何 *.tmp.* 半文件");
});

// ============================================================================
// 多 epoch / 幂等：last-wins 覆盖同一文件，每次写入都追加事件
// ============================================================================

test("g-374 F1：多 epoch last-wins——同 attempt 二次写入覆盖同一文件且事件累加", () => {
  const { root, goal, attempt, dir } = setup();
  writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "completed", text: "epoch-1" });
  writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "completed", text: "epoch-2" });

  const raw = readFileSync(join(dir, `results-${attempt}.md`), "utf8");
  assert.ok(raw.includes("epoch-2"), "last-wins：保留最后一次");
  assert.ok(!raw.includes("epoch-1"), "旧 epoch 内容被整体覆盖");
  const evs = resultsEvents(root, "attempt.results_written").filter((e) => e.goal === goal);
  assert.equal(evs.length, 2, "每次写入都追加事件（可审计）");
  assert.equal(evs[0].details.overwrite, false);
  assert.equal(evs[1].details.overwrite, true, "第二次写入标注覆盖");
  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith("results-")), [`results-${attempt}.md`], "同一 attempt 只有一份文件");
});

// ============================================================================
// source 开放取值（负责人 2026-09-29 补充：为 F3 manual 预留，不改本文件即可扩展）
// ============================================================================

test("g-374 F1：source 为开放取值——已知含 manual，未知取值原样落盘且格式不变", () => {
  assert.ok((ATTEMPT_RESULTS_SOURCES as readonly string[]).includes("subagent/end"));
  assert.ok((ATTEMPT_RESULTS_SOURCES as readonly string[]).includes("manual"), "manual 必须预留");
  assert.ok((ATTEMPT_RESULTS_SOURCES as readonly string[]).includes("child_error"));
  assert.ok((ATTEMPT_RESULTS_SOURCES as readonly string[]).includes("abandon"));
  assert.ok((ATTEMPT_RESULTS_SOURCES as readonly string[]).includes("detach"));

  const { root, goal, attempt, dir } = setup();
  const r1 = writeAttemptResults(root, { goal, attempt, source: "manual" as any, childId: null, text: "主管手写摘要" });
  assert.equal(r1.written, true);
  assert.ok(readFileSync(join(dir, `results-${attempt}.md`), "utf8").includes("source: manual"));
  // 未来新增来源无需改写入器：未知取值原样落盘
  const r2 = writeAttemptResults(root, { goal, attempt, source: "custom/source" as any, childId: null, text: "x" });
  assert.equal(r2.written, true);
  assert.ok(readFileSync(join(dir, `results-${attempt}.md`), "utf8").includes("source: custom/source"));
  assert.equal(resultsEvents(root, "attempt.results_written").length, 2);
});

// ============================================================================
// 只读投影：读取容错（缺失/损坏/超大不抛错）、倒序、results.md
// ============================================================================

test("g-374 F1：goalResults 只读投影——倒序、results.md、缺失/损坏/超大一律不抛错", () => {
  const { root, goal, attempt, dir } = setup();
  assert.equal(attempt, "att-001");
  writeAttemptResults(root, { goal, attempt, source: "subagent/end", childId: "c1", stopReason: "completed", text: "A" });
  writeFileSync(join(dir, "results-att-002.md"), "att-002 内容");
  writeFileSync(join(dir, "results-att-010.md"), "att-010 内容");
  writeFileSync(join(dir, "results.md"), "> 规范化摘要\n\n正文");
  // 损坏文件（无机器头）与超大文件（> 读取上限）：都必须降级而不是抛错
  writeFileSync(join(dir, "results-att-003.md"), "损坏：没有机器头");
  writeFileSync(join(dir, "results-att-004.md"), "x".repeat(ATTEMPT_RESULTS_READ_MAX_BYTES + 10));
  // 非 attempt 结果文件必须排除（F2 归档）
  writeFileSync(join(dir, "results-archive-20260101T000000.md"), "归档");

  const r = goalResults(root, goal);
  assert.ok(r.summary, "results.md 作为 summary 投影");
  assert.ok(r.summary!.body.includes("规范化摘要"));
  assert.deepEqual(
    r.attempts.map((a) => a.attempt),
    ["att-010", "att-004", "att-003", "att-002", "att-001"],
    "attempt 倒序 + F2 归档排除",
  );
  const corrupt = r.attempts.find((a) => a.attempt === "att-003")!;
  assert.equal(corrupt.degraded, "unparsable-header", "损坏文件降级而非抛错");
  assert.ok(corrupt.body.includes("没有机器头"), "损坏文件仍显示原文（可见降级）");
  const huge = r.attempts.find((a) => a.attempt === "att-004")!;
  assert.equal(huge.degraded, "oversized", "超大文件降级而非抛错");
  assert.equal(huge.attempt, "att-004");
  // g-374 F2：历史归档可列举（且不被当作 attempt 结果文件）；总量预算未触发时 omitted=0
  assert.deepEqual(r.archives, ["results-archive-20260101T000000.md"], "归档可枚举（唯一真源正则）");
  assert.equal(r.omitted, 0, "总量预算内不得削减下发");

  // 目标不存在 ⇒ 空投影，不抛错
  assert.deepEqual(goalResults(root, "g-does-not-exist"), { summary: null, attempts: [], omitted: 0, archives: [] });
});

// ============================================================================
// 边界：非法输入/backlog 目标 ⇒ 返回 skipped，永不抛出（不打断 attempt 生命周期）
// ============================================================================

test("g-374 F1：写入器永不抛出——非法 attempt / 不存在的目标 / 空 root 均返回 skipped", () => {
  const { root, goal } = setup();
  for (const bad of [
    { goal, attempt: "../escape", source: "subagent/end" as const, text: "x" },
    { goal, attempt: "", source: "subagent/end" as const, text: "x" },
    { goal: "g-nope", attempt: "att-001", source: "subagent/end" as const, text: "x" },
    { goal: "", attempt: "att-001", source: "subagent/end" as const, text: "x" },
  ]) {
    const res = writeAttemptResults(root, bad as any);
    assert.equal(res.written, false, JSON.stringify(bad));
    assert.equal(res.skipped, true);
    assert.ok(res.reason, "必须给出原因");
  }
  assert.equal(writeAttemptResults("", { goal, attempt: "att-001", source: "subagent/end", text: "x" }).skipped, true);
  // 失败路径零副作用：不产生结果文件、不产生事件
  assert.deepEqual(resultsEvents(root, "attempt.results_written"), []);
  assert.deepEqual(resultsEvents(root, "attempt.results_skipped"), []);
});
