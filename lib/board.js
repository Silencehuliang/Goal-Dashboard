/**
 * The board page shell.
 *
 * Deliberately a self-contained, server-rendered HTML document served by the
 * plugin's own loopback server — NOT a DSH client bundle.
 *
 * Why not a client bundle: a DSH client entry that fails to activate aborts the
 * whole web boot, so a bad bundle takes the entire GUI down with it. A page on
 * our own port can only ever fail to render itself.
 *
 * Why not the host's web server: the desktop refuses to display its own origin
 * inside the embedded browser (same port + localhost/127.0.0.1), so a page on
 * the host's port can never be opened inside DSH. See lib/server.js.
 *
 * The shell carries no goal data; the client script fetches it from /api/state
 * and builds DOM with textContent only, so goal text can never inject markup.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render the static shell. `now` is the only interpolated value. */
export function renderBoardHtml({ now = new Date().toISOString() } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goal Dashboard</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header>
  <h1>Goal Dashboard</h1>
  <span id="stats" class="meta">加载中…</span>
  <span class="grow"></span>
  <button id="refresh">刷新</button>
  <button id="auto">自动刷新：开</button>
</header>
<div id="err"></div>
<div class="newbar">
  <input id="title" type="text" placeholder="新目标标题" size="34">
  <select id="type">
    <option value="task">任务 task</option>
    <option value="feature">特性 feature</option>
    <option value="bug">缺陷 bug</option>
    <option value="improvement">改进 improvement</option>
    <option value="patch">补丁 patch</option>
    <option value="chore">杂务 chore</option>
  </select>
  <button id="create" class="primary">创建目标</button>
</div>
<div id="board" class="board"></div>
<footer>
  数据源 <code>.goal-board/</code>（goals/&lt;slug&gt;.json + 只追加 events.jsonl） · 页面生成于 ${escapeHtml(now)}
</footer>
<script src="/app.js"></script>
</body>
</html>
`;
}
