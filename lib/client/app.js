/**
 * Board client script. Served as a static asset (never imported by Node).
 *
 * Two constraints shape this file:
 *   1. the host's embedded webview runs with `disableDialogs: true`, so
 *      alert/confirm/prompt never appear — every confirmation is inline;
 *   2. goal titles/notes are arbitrary user text, so all dynamic content goes
 *      through textContent, never innerHTML.
 */
(() => {
  "use strict";

  const WS = new URLSearchParams(location.search).get("workspace");
  const withWs = (path) =>
    WS ? `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(WS)}` : path;

  let STATE = null;
  let AUTO = true;
  let timer = null;

  const h = (tag, props, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null) continue;
      el.append(child);
    }
    return el;
  };

  const notify = (message, kind) => {
    const el = document.getElementById("err");
    if (!el) return;
    el.textContent = message;
    el.className = message ? "on" : "";
    if (kind === "info" && message) setTimeout(() => { el.className = ""; }, 2500);
  };

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? undefined : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  }

  async function run(cmd, payload) {
    try {
      notify("");
      const out = await api(withWs("/api/command"), { cmd, payload: payload || {} });
      if (out && out.warning) notify(out.warning, "info");
      await refresh();
    } catch (error) {
      notify(String(error.message || error));
    }
  }

  async function refresh() {
    try {
      STATE = await api(withWs("/api/state"));
      render();
    } catch (error) {
      notify(String(error.message || error));
    }
  }

  const label = (status) => (STATE.columns.find((c) => c.status === status) || {}).label || status;

  function card(goal) {
    const el = h("div", { class: `card st-${goal.status}${goal.archived ? " archived" : ""}` });

    el.append(h("div", { class: "title", text: goal.title }));
    el.append(h("div", { class: "meta", text: `${goal.id} · ${goal.type}` }));

    // criteria -------------------------------------------------------------
    if (goal.criteria.length > 0) {
      const box = h("div", { class: "crit" });
      for (const item of goal.criteria) {
        const cb = h("input", {
          type: "checkbox",
          onchange: () => run("markCriterion", { goal: goal.id, criterion: item.text, verified: cb.checked }),
        });
        cb.checked = item.verified === true;
        box.append(h("label", {}, cb, h("span", { text: item.text })));
      }
      el.append(box);
    }

    // transition -----------------------------------------------------------
    const allowed = (STATE.transitions[goal.status] || []).filter((s) => s !== "blocked");
    const select = h("select", {});
    select.append(h("option", { value: "", text: "变更状态…" }));
    for (const status of allowed) select.append(h("option", { value: status, text: label(status) }));
    select.append(h("option", { value: "blocked", text: "阻塞（需原因）" }));

    const reason = h("input", { type: "text", placeholder: "原因（阻塞必填）", size: "14" });
    const apply = h("button", {
      class: "tiny",
      text: "应用",
      onclick: () => {
        if (!select.value) return notify("请先选择一个目标状态", "info");
        run("transition", { goal: goal.id, to: select.value, reason: reason.value.trim() || undefined });
      },
    });
    el.append(h("div", { class: "row" }, select, reason, apply));

    // workflow -------------------------------------------------------------
    if (goal.workflow) {
      const wf = goal.workflow;
      el.append(h("div", {
        class: "wf",
        text: `🧭 ${wf.presetId} · 阶段 ${wf.stageIndex + 1}/${wf.stageCount}：${wf.stage || "-"}（${wf.status}）`,
      }));
      if (wf.status === "active") {
        el.append(h("div", { class: "row" },
          h("button", { class: "tiny", text: "推进阶段", onclick: () => run("workflowAdvance", { goal: goal.id }) }),
        ));
      }
    } else {
      const preset = h("select", {});
      preset.append(h("option", { value: "", text: "启动工作流…" }));
      for (const p of STATE.presets) preset.append(h("option", { value: p.id, text: p.title }));
      el.append(h("div", { class: "row" }, preset,
        h("button", {
          class: "tiny", text: "启动",
          onclick: () => {
            if (!preset.value) return notify("请先选择一个工作流预设", "info");
            run("workflowStart", { goal: goal.id, preset: preset.value });
          },
        }),
      ));
    }

    // note + archive -------------------------------------------------------
    const note = h("textarea", { placeholder: "追加一条备注（历史讨论 / 决策 / 失败原因）" });
    el.append(h("details", {},
      h("summary", { text: "备注 / 归档" }),
      h("div", { class: "row" },
        h("button", {
          class: "tiny", text: "保存备注",
          onclick: () => {
            const text = note.value.trim();
            if (!text) return notify("备注不能为空", "info");
            note.value = "";
            run("note", { goal: goal.id, text });
          },
        }),
        h("button", {
          class: `tiny${goal.archived ? "" : " danger"}`,
          text: goal.archived ? "恢复" : "归档",
          onclick: (event) => {
            const btn = event.currentTarget;
            if (!goal.archived && btn.dataset.armed !== "1") {
              btn.dataset.armed = "1";
              btn.textContent = "确认归档？";
              setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "归档"; }, 4000);
              return;
            }
            run("archive", { goal: goal.id, archived: !goal.archived });
          },
        }),
      ),
      note,
    ));

    return el;
  }

  function render() {
    const board = document.getElementById("board");
    board.textContent = "";
    for (const col of STATE.columns) {
      const cards = STATE.byStatus[col.status] || [];
      const section = h("section", { class: "col" });
      section.append(h("h2", {}, h("span", { text: col.label }), h("span", { class: "count", text: String(cards.length) })));
      if (cards.length === 0) section.append(h("div", { class: "empty", text: "—" }));
      else for (const goal of cards) section.append(card(goal));
      board.append(section);
    }
    document.getElementById("stats").textContent =
      `${STATE.total} 个目标 · ${STATE.events} 条事件 · ${STATE.archivedCount} 个已归档 · ${STATE.root}`;
  }

  function boot() {
    document.getElementById("create").addEventListener("click", () => {
      const title = document.getElementById("title");
      const value = title.value.trim();
      if (!value) return notify("目标标题不能为空", "info");
      const type = document.getElementById("type").value;
      title.value = "";
      run("createGoal", { title: value, type });
    });

    document.getElementById("refresh").addEventListener("click", () => refresh());
    document.getElementById("auto").addEventListener("click", (event) => {
      AUTO = !AUTO;
      event.currentTarget.textContent = AUTO ? "自动刷新：开" : "自动刷新：关";
    });

    timer = setInterval(() => { if (AUTO && document.visibilityState === "visible") refresh(); }, 5000);
    window.addEventListener("beforeunload", () => clearInterval(timer));
    refresh();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
