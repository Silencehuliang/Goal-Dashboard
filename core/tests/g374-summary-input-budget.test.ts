// g-374 F7：报文字节上限**三层分离**（历史留档完整 / 只省喂给 LLM 的那一份）。
//
// 契约（负责人 2026-09-29 追加）：
//  ① 报文本体软上限 4 KiB（写进骨架规范 + 分预算；超限不算失败但须自报）—— 规范面由 F6 套件钉住；
//  ② 送 LLM 摘要的输入硬上限：每 attempt 8 KiB（头 4 KiB + 尾 2 KiB + 中段省略标记，含省略字节数）；
//     单次总输入预算 256 KiB（超出 ⇒ 只送机器头 + 骨架要点，并标注「预算受限模式」）；
//  ③ 落盘 64 KiB / 读取 1 MiB **不变**（不得把 ATTEMPT_RESULTS_MAX_BYTES 改小）。
//  边界用例：4 KiB / 8 KiB / 256 KiB 阈值上下、多字节不被切坏、省略标注可见、预算耗尽仍能出摘要。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  init, createGoal, setCriteria, startAttempt, writeAttemptResults, appendGoalComment,
  refreshGoalResults, goalResultsSummaryFile, findGoalFile,
  goalResultsDigest, goalDetail, renderGoalResultsDigestWithBudget, summaryInputBudget,
  truncateSummaryInput, ATTEMPT_RESULTS_MAX_BYTES, GOAL_RESULTS_MAX_BYTES,
  SUMMARY_INPUT_ATTEMPT_MAX_BYTES, SUMMARY_INPUT_ATTEMPT_HEAD_BYTES, SUMMARY_INPUT_ATTEMPT_TAIL_BYTES,
  SUMMARY_INPUT_TOTAL_MAX_BYTES, ATTEMPT_REPORT_SOFT_MAX_BYTES,
} from "../ops.ts";
import { readEvents } from "../events.ts";
import { createHarness, prepare, dispatch } from "./_g374-harness.ts";

const ascii = (n: number) => "a".repeat(n);
const cjk = (n: number) => { let s = ""; while (Buffer.byteLength(s, "utf8") < n) s += "汉字"; return s; };
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

// ============================================================================
// ③ 三层分离：落盘/读取上限不变（防止「省 token」把历史留档一起砍掉）
// ============================================================================

test("g-374 F7 三层分离：落盘 64 KiB / 读取 1 MiB 不变，软上限 4 KiB 与硬上限 8 KiB 分开", () => {
  assert.equal(ATTEMPT_RESULTS_MAX_BYTES, 64 * 1024, "落盘上限必须仍是 64 KiB（历史留档完整）");
  assert.equal(GOAL_RESULTS_MAX_BYTES, 128 * 1024, "results.md 落盘上限不变");
  assert.equal(ATTEMPT_REPORT_SOFT_MAX_BYTES, 4 * 1024, "报文本体软上限 = 4 KiB（只提醒，不截断）");
  assert.equal(SUMMARY_INPUT_ATTEMPT_MAX_BYTES, 8 * 1024, "送 LLM 的每 attempt 硬上限 = 8 KiB");
  assert.equal(SUMMARY_INPUT_ATTEMPT_HEAD_BYTES, 4 * 1024, "头 4 KiB");
  assert.equal(SUMMARY_INPUT_ATTEMPT_TAIL_BYTES, 2 * 1024, "尾 2 KiB");
  assert.equal(SUMMARY_INPUT_TOTAL_MAX_BYTES, 256 * 1024, "总输入预算 = 256 KiB");
  assert.ok(SUMMARY_INPUT_ATTEMPT_MAX_BYTES < ATTEMPT_RESULTS_MAX_BYTES / 4, "喂 LLM 的份额必须明显小于落盘上限");
});

// ============================================================================
// ② 8 KiB 阈值上下 + 多字节安全
// ============================================================================

test("g-374 F7：8 KiB 阈值——恰好 8 KiB 不截取；8193 字节截取并给出真实省略字节数", () => {
  const exact = truncateSummaryInput(ascii(8192));
  assert.equal(exact.truncated, false, "恰好 8 KiB 不得截取（阈值取下不含上）");
  assert.equal(exact.omitted_bytes, 0);
  assert.equal(exact.text, ascii(8192));

  const over = truncateSummaryInput(ascii(8193));
  assert.equal(over.truncated, true);
  assert.ok(bytes(over.text) <= SUMMARY_INPUT_ATTEMPT_MAX_BYTES, "输出必须放得进预算");
  assert.equal(over.omitted_bytes, 8193 - 4096 - 2048, "省略字节数必须是真实差额（头/尾各留 4/2 KiB）");
  assert.ok(over.text.startsWith(ascii(4096)), "头 4 KiB 原样保留");
  assert.ok(over.text.endsWith(ascii(2048)), "尾 2 KiB 原样保留");
  assert.ok(over.text.includes(`省略 ${over.omitted_bytes} 字节`), "中段必须带省略标记（含字节数）");
  assert.ok(over.text.includes(`<!-- dsh-graph:summary-input-omitted bytes=${over.omitted_bytes} -->`), "标记必须机器可读");
});

test("g-374 F7：4 KiB 阈值（软上限口径）——截取函数同样以 4 KiB 为界且不切坏内容", () => {
  assert.equal(truncateSummaryInput(ascii(4096), 4096).truncated, false);
  const over = truncateSummaryInput(ascii(4097), 4096);
  assert.equal(over.truncated, true);
  assert.ok(bytes(over.text) <= 4096, "4 KiB 预算下输出也必须放得进");
  assert.ok(over.omitted_bytes > 0);
});

test("g-374 F7：多字节安全——CJK 报文截取后无替换字符、无半字符，字节数可复算", () => {
  const text = cjk(20000); // 3 字节/字
  const r = truncateSummaryInput(text, 8192);
  assert.equal(/\uFFFD/.test(r.text), false, "不得出现 UTF-8 替换字符（说明没切坏字符）");
  assert.equal(r.text.normalize("NFC"), r.text, "不得出现半个字符导致的组合异常");
  assert.ok(r.text.startsWith("汉字".repeat(500)), "头部必须整字保留（不是半个字符）");
  assert.ok(bytes(r.text) <= 8192);
  // 复算：省略字节 = 原文 - 头（标记前）- 尾（标记后），三段都由输出自身切出 ⇒ 可独立复算。
  const markerAt = r.text.indexOf("<!-- dsh-graph:summary-input-omitted");
  const headPart = r.text.slice(0, markerAt).replace(/\n+$/, ""); // 去掉分隔空行后应是完整字符序列
  const segments = r.text.split("…\n\n"); // 省略标记形如 `…[摘要输入省略 N 字节]…\n\n`
  const tailPart = segments[segments.length - 1].replace(/\n+$/, "");
  assert.equal(bytes(headPart) % 3, 0, "头部字节数必须是 3 的整数倍（CJK 整字）");
  assert.equal(bytes(tailPart) % 3, 0, "尾部字节数必须也是 3 的整数倍（CJK 整字）");
  assert.equal(r.omitted_bytes, bytes(text) - bytes(headPart) - bytes(tailPart), "省略字节数必须可复算");
});

// ============================================================================
// ② digest 单 attempt 口径（走真实目标历史）
// ============================================================================

test("g-374 F7：digest 单 attempt——恰好 8 KiB 报文本体不截、8193 字节截取且摘要材料里标注省略", async () => {
  const ws = mkdtempSync(join(tmpdir(), "dsh-graph-g374-f7-"));
  const root = join(ws, ".dsh-graph");
  init(root);
  const goal = createGoal(root, { title: "预算", version: "v1", actor: "human:gui", description: "影响面：宿主。" });
  setCriteria(root, goal, ["判据 1"], "human:gui");
  const exact = startAttempt(root, goal, { executor: "agent:e", actor: "human:gui" });
  // 写入器会在正文前加机器说明 ⇒ 先量出「读回的报文本体」的真实开销，再对齐 8 KiB 边界。
  writeAttemptResults(root, { goal, attempt: exact, source: "subagent/end", childId: "c1", stopReason: "completed", text: ascii(1000) });
  const probeBody = goalResultsDigest(goalDetail(root, goal)).attempts[0].result_full ?? "";
  const overhead = bytes(probeBody) - 1000;
  assert.ok(overhead > 0, "写入器必须给报文本体加机器说明");

  writeAttemptResults(root, { goal, attempt: exact, source: "subagent/end", childId: "c1", stopReason: "completed", text: ascii(8192 - overhead) });
  const d1 = goalResultsDigest(goalDetail(root, goal));
  assert.equal(bytes(d1.attempts[0].result_full ?? ""), 8192, "边界用例前置：读回的报文本体必须恰好 8 KiB");
  const r1 = renderGoalResultsDigestWithBudget(d1, 1);
  assert.equal(r1.omitted_bytes, 0, "恰好 8 KiB 不省略");
  assert.ok(r1.text.includes("交付报文（全文）"));

  writeAttemptResults(root, { goal, attempt: exact, source: "subagent/end", childId: "c1", stopReason: "completed", text: ascii(8193 - overhead) });
  const d2 = goalResultsDigest(goalDetail(root, goal));
  assert.equal(bytes(d2.attempts[0].result_full ?? ""), 8193, "边界用例前置：读回的报文本体必须恰好 8193 字节");
  const r2 = renderGoalResultsDigestWithBudget(d2, 1);
  assert.equal(r2.omitted_bytes, 8193 - 4096 - 2048);
  assert.match(r2.text, /已按预算截取\*\*：省略 \d+ 字节/, "材料包必须标注省略");
  assert.ok(r2.per_attempt.some((x) => x.omitted_bytes > 0), "省略必须可归因到 attempt");
});

// ============================================================================
// ② 256 KiB 总预算：预算受限模式
// ============================================================================

test("g-374 F7：256 KiB 总预算——超出 ⇒ 只送机器头 + 骨架要点，标注「预算受限模式」且仍可产出摘要", async () => {
  const ws = mkdtempSync(join(tmpdir(), "dsh-graph-g374-f7b-"));
  const root = join(ws, ".dsh-graph");
  init(root);
  const goal = createGoal(root, { title: "巨量判据", version: "v1", actor: "human:gui", description: "影响面：宿主。" });
  // 真实数据把 digest 顶过 256 KiB（判据逐字进材料包）。
  setCriteria(root, goal, Array.from({ length: 6000 }, (_, i) => `判据 ${i}：` + "y".repeat(40)), "human:gui");
  const full = renderGoalResultsDigestWithBudget(goalResultsDigest(goalDetail(root, goal)), 6);
  assert.equal(full.limited, true, "超总预算必须进入受限模式");
  assert.ok(bytes(full.text) <= SUMMARY_INPUT_TOTAL_MAX_BYTES, "受限模式输出必须放得进总预算");
  assert.match(full.text, /预算受限模式/);
  assert.match(full.text, /原文省略/, "受限模式必须标注判据原文被省略");
  assert.ok(full.omitted_bytes > 0, "省略字节数必须如实为正（不得为负/零）");
  assert.match(full.text, new RegExp(`bytes=${full.omitted_bytes}`), "省略标记必须与统计一致");

  // 预算耗尽仍能产出摘要：写入器零 LLM 自算预算 ⇒ 正文与机器头都留痕，不抛错、不空文件。
  const w = refreshGoalResults(root, goal, {
    actor: "agent:summarizer", content: "## 结论\n判据原文因预算受限未提供。", source: "llm",
  });
  assert.equal(w.written, true, "预算耗尽也必须照常落盘");
  assert.ok(existsSync(w.file));
  const raw = readFileSync(w.file, "utf8");
  assert.match(raw, /^input_budget: omitted=\d+ limited=true$/m, "机器头必须标注预算状态");
  assert.ok(raw.includes("预算受限模式"), "摘要在正文里必须可见地标注受限");
  assert.ok(w.bytes > bytes("## 结论\n判据原文因预算受限未提供。"), "正文与标注都必须落盘");

  // event 里同样留痕（审计面）
  const ev = readEvents(root).filter((e: any) => e.event === "goal.results_summary_written");
  assert.ok(ev.length > 0, "写入必须留痕");
  assert.equal((ev[ev.length - 1] as any).details?.input_budget?.limited, true, "事件里必须带受限标记");
});

test("g-374 F7：总预算内（未超）不得出现受限标注，也不得凭空生成 input_budget 字段", async () => {
  const h = createHarness();
  const { goal } = prepare(h);
  const attempt = await dispatch(h, goal);
  h.call("graph_write_results", { goal, attempt, text: "简短报文。" });
  appendGoalComment(h.root, goal, "小目标。", "human:gui");
  const w = refreshGoalResults(h.root, goal, { actor: "human:gui" });
  const raw = readFileSync(w.file, "utf8");
  assert.doesNotMatch(raw, /input_budget:/, "无省略/未受限时不得出现该字段（固定字段集契约）");
  assert.ok(!raw.includes("预算受限模式"));
  assert.equal(summaryInputBudget(goalResultsDigest(goalDetail(h.root, goal))).limited, false);
});

// ============================================================================
// 省略标注可见性（正文 + 机器头/事件，二者必居其一以上）
// ============================================================================

test("g-374 F7：被省略的字节数同时出现在摘要正文与机器头（人可见 + 机可读）", async () => {
  const ws = mkdtempSync(join(tmpdir(), "dsh-graph-g374-f7c-"));
  const root = join(ws, ".dsh-graph");
  init(root);
  const goal = createGoal(root, { title: "长报文", version: "v1", actor: "human:gui", description: "影响面：宿主。" });
  setCriteria(root, goal, ["判据 1"], "human:gui");
  const att = startAttempt(root, goal, { executor: "agent:e", actor: "human:gui" });
  writeAttemptResults(root, { goal, attempt: att, source: "subagent/end", childId: "c1", stopReason: "completed", text: ascii(20000) });
  const w = refreshGoalResults(root, goal, { actor: "agent:summarizer", content: "## 结论\n长报文已摘要。", source: "llm" });
  const raw = readFileSync(w.file, "utf8");
  const m = /^input_budget: omitted=(\d+) limited=false$/m.exec(raw);
  assert.ok(m, `机器头必须给出省略字节数：\n${raw.slice(0, 400)}`);
  const omitted = Number(m![1]);
  assert.ok(omitted > 0);
  assert.ok(raw.includes(`省略 ${omitted} 字节`), "正文里必须出现同一个省略字节数（人可见）");
  const ev = readEvents(root).filter((e: any) => e.event === "goal.results_summary_written").pop() as any;
  assert.equal(ev?.details?.input_budget?.omitted_bytes, omitted, "事件里的省略字节数必须与正文/机器头一致");
});

test("g-374 F7：省略标记必须真的截掉了中段内容（不是贴个标记却把全文都送进去）", async () => {
  const mid = "MIDDLE-MUST-BE-DROPPED";
  const text = ascii(5000) + mid + ascii(5000);
  const r = truncateSummaryInput(text, 8192);
  assert.equal(r.truncated, true);
  assert.ok(!r.text.includes(mid), "中段必须真的被省略（否则等于没省 token）");
  assert.ok(r.text.includes(`省略 ${r.omitted_bytes} 字节`));
  assert.ok(bytes(r.text) <= 8192);
});

// ============================================================================
// 与写入器/UI 的边界：省略标注不得破坏固定字段集与归档策略
// ============================================================================

test("g-374 F7：带预算标注的 llm 写入仍走同一归档/同一路径/同一读取器", async () => {
  const ws = mkdtempSync(join(tmpdir(), "dsh-graph-g374-f7d-"));
  const root = join(ws, ".dsh-graph");
  init(root);
  const goal = createGoal(root, { title: "归档", version: "v1", actor: "human:gui", description: "影响面：宿主。" });
  setCriteria(root, goal, ["判据 1"], "human:gui");
  const att = startAttempt(root, goal, { executor: "agent:e", actor: "human:gui" });
  writeAttemptResults(root, { goal, attempt: att, source: "subagent/end", childId: "c1", stopReason: "completed", text: ascii(20000) });
  const file = goalResultsSummaryFile(findGoalFile(root, goal));
  const first = refreshGoalResults(root, goal, { actor: "human:gui", stamp: "20260101T050101" });
  const second = refreshGoalResults(root, goal, {
    actor: "agent:summarizer", stamp: "20260101T050102", content: "## 结论\nLLM 版。", source: "llm",
  });
  assert.equal(second.file, file, "同路径");
  assert.match(String(second.archive ?? ""), /results-archive-\d{8}T\d{6}\.md$/, "同归档策略");
  assert.equal(first.file, second.file);
  const dir = join(root, "versions/v1/goals", goal);
  assert.ok(readdirSync(dir).some((n) => n.startsWith("results-archive-")));
  assert.equal(second.truncated, false, "小正文不得触发截断");
});
