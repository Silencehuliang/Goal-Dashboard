/**
 * The board page.
 *
 * Deliberately a self-contained, server-rendered HTML document served by the
 * plugin over HTTP — NOT a DSH client bundle.
 *
 * Why: a DSH client bundle is loaded by the host's module composer, and if an
 * entry cannot activate the host aborts the whole web boot, so a bad bundle
 * takes the entire GUI down with it. A page served by our own route can only
 * ever fail to render itself. The trade is real (no in-GUI tab); the safety is
 * worth it, and it keeps this plugin inside the documented host contract.
 */

import { boardColumns } from "./model.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root{color-scheme:dark light}
*{box-sizing:border-box}
body{margin:0;font:13px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;background:#14161a;color:#e6e8ea}
header{padding:16px 20px;border-bottom:1px solid #2a2f37;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}
.meta{color:#8b939e;font-size:12px}
.board{display:flex;gap:12px;padding:16px;overflow-x:auto;align-items:flex-start}
.col{min-width:230px;flex:1 0 230px;background:#1a1d23;border:1px solid #262b33;border-radius:10px;padding:10px}
.col h2{font-size:12px;margin:0 0 8px;color:#9aa3ae;font-weight:600;display:flex;justify-content:space-between}
.count{background:#252b34;border-radius:999px;padding:0 7px;color:#c8cfd8}
.card{background:#222731;border:1px solid #2e3542;border-left:3px solid #4c7dff;border-radius:8px;padding:9px 10px;margin-bottom:8px}
.card.blocked{border-left-color:#e0603a}
.card.delivered{border-left-color:#3fb27f}
.card.review{border-left-color:#c9a227}
.title{font-weight:600;margin-bottom:4px;word-break:break-word}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:11px;color:#96a0ac}
.tag{background:#2b323d;border-radius:4px;padding:1px 6px}
.ok{color:#3fb27f}.bad{color:#e0603a}
.wf{margin-top:6px;font-size:11px;color:#9db4e8}
.empty{color:#5f6873;font-size:12px;padding:4px 2px}
footer{padding:10px 20px;color:#6b7480;font-size:11px;border-top:1px solid #2a2f37}
code{background:#222731;padding:1px 5px;border-radius:4px}
`;

/** Render the full HTML document for a board snapshot. */
export function renderBoardHtml(snapshot, { now = new Date().toISOString(), token } = {}) {
  const columns = boardColumns();
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  const cols = columns
    .map((col) => {
      const cards = snapshot.byStatus[col.status] ?? [];
      const body = cards.length === 0
        ? `<div class="empty">—</div>`
        : cards
            .map((card) => {
              const wf = card.workflow
                ? `<div class="wf">🧭 ${escapeHtml(card.workflow.presetId)} · 阶段 ${card.workflow.stageIndex + 1}/${card.workflow.stageCount} · ${escapeHtml(card.workflow.stage ?? "-")}</div>`
                : "";
              const criteria = card.criteria === 0
                ? `<span class="tag bad">无判据</span>`
                : `<span class="tag ${card.criteriaVerified ? "ok" : "bad"}">判据 ${card.criteria - card.unverified}/${card.criteria}</span>`;
              return `<div class="card ${escapeHtml(card.id === undefined ? "" : card.archived ? "delivered" : "")} ${escapeHtml(col.status)}">
  <div class="title">${escapeHtml(card.title)}</div>
  <div class="meta"><code>${escapeHtml(card.id)}</code> · ${escapeHtml(card.type)}</div>
  <div class="tags">${criteria}<span class="tag">${escapeHtml(col.label)}</span></div>
  ${wf}
</div>`;
            })
            .join("\n");
      return `<section class="col">
  <h2>${escapeHtml(col.label)} <span class="count">${cards.length}</span></h2>
  ${body}
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goal Dashboard</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>Goal Dashboard</h1>
  <span class="meta">${snapshot.total} 个目标 · ${snapshot.events} 条事件</span>
  <span class="meta">${escapeHtml(snapshot.root)}</span>
  <span class="meta"><a href="${suffix}" style="color:#8ab4ff">刷新</a></span>
</header>
<div class="board">
${cols}
</div>
<footer>
只读投影 · 生成于 ${escapeHtml(now)} · 数据源 <code>.goal-board/</code>（goals/&lt;slug&gt;.json + 只追加 events.jsonl）
${token ? " · 本次访问带 token" : ""}
</footer>
</body>
</html>
`;
}
