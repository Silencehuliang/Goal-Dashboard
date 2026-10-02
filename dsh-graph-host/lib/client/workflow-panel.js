    // ===== mattpocock/skills 技能工作流条（只读 v1）=====
    // 数据契约（workspace 级，由 host 侧 skills 工作流实现提供；客户端只读，不发明 workspace 解析器）：
    //   GET /api/dsh-graph/workflows?workspace=<ws>  -> 200 JSON
    //   { "active": [ { "goal": "<slug>", "id", "title", "stageId", "stageTitle", "lane",
    //                   "stageIndex", "stageCount", "status": "active"|"completed"|"blocked",
    //                   // 可选（card 面/扩展载荷才带）：stages:[{id,title,skill,lane,
    //                   //   state:"done"|"active"|"pending"|"skipped"}] } ] }
    //
    // 挂载点：conversation.session.header.actions（会话头 list slot）。该处没有 goal 上下文，
    // 因此**只调 workspace 级 /api/dsh-graph/workflows，绝不下发 goal 参数**（编造 slug 比不显示更糟）。
    //
    // 爆炸半径纪律：本模块与看板同级（client bundle 坏了整个 GUI 起不来），因此
    //   - 非 2xx（端点未接线 → 404）、非 JSON、active 缺失/非数组/为空、条目形状不符、
    //     网络异常、无 workspace ⇒ 一律「不渲染」（组件返回 null），绝不抛进会话头/看板渲染路径；
    //   - 取数只用既有 graphUrl(...) + 同源 fetch（workspace 解析唯一真源在 plugin.js）；
    //   - 所有用户可见文案走 dgT(key)，键在 i18n.js 的 zh/en 字典中成对登记。
    //
    // 归位：本模块必须排在 drag-prompts 之前（工厂作用域），否则会成为 KanbanView 内部
    // 嵌套函数（每次渲染产生新的组件身份）。见 scripts/build-client.sh 的 PARTS 注释。

    // 阶段状态 / 工作流状态的受控枚举（契约之外的取值一律按安全默认降级）。
    const WF_STAGE_STATES = new Set(["done", "active", "pending", "skipped"]);
    const WF_STATUSES = new Set(["active", "completed", "blocked"]);
    const WF_STAGE_GLYPH = { done: "✓", active: "●", pending: "○", skipped: "–" };

    const WF_STYLE = {
      strip: {
        display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap",
        overflow: "hidden", minWidth: 0, maxWidth: 420, padding: "2px 7px",
        borderRadius: 6, fontSize: 12, lineHeight: 1.4, whiteSpace: "nowrap",
        background: "var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,.15))",
        color: "var(--dsw-alias-label-secondary, inherit)",
      },
      label: { fontWeight: 600, flexShrink: 0 },
      count: {
        flexShrink: 0, padding: "0 5px", borderRadius: 999,
        background: "var(--dsw-alias-interactive-bg, rgba(128,128,128,.25))",
      },
      title: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
      stage: {
        minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      position: { opacity: 0.7, flexShrink: 0 },
      dots: { display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 },
      dot: {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, borderRadius: 999, flexShrink: 0,
        border: "1px solid rgba(128,128,128,.45)", fontSize: 9, lineHeight: 1,
      },
      dotDone: { borderColor: "rgba(58,166,117,.75)", color: "#3aa675" },
      dotActive: { borderColor: "#4c8dff", color: "#4c8dff", fontWeight: 700 },
      dotPending: { opacity: 0.45 },
      dotSkipped: { opacity: 0.3, borderStyle: "dashed" },
      status: {
        flexShrink: 0, padding: "0 6px", borderRadius: 999,
        border: "1px solid rgba(128,128,128,.35)",
      },
      statusActive: { color: "#4c8dff", borderColor: "rgba(76,141,255,.55)" },
      statusCompleted: { color: "#3aa675", borderColor: "rgba(58,166,117,.55)" },
      statusBlocked: { color: "#d66", borderColor: "rgba(221,102,102,.55)" },
    };

    /** 阶段状态 → 圆点样式（未知状态按 pending 处理）。 */
    function wfDotStyle(state) {
      if (state === "done") return WF_STYLE.dotDone;
      if (state === "active") return WF_STYLE.dotActive;
      if (state === "skipped") return WF_STYLE.dotSkipped;
      return WF_STYLE.dotPending;
    }

    /** 阶段状态 → 本地化文案（字典缺键时退回原始枚举值，绝不抛错）。 */
    function wfStageStateLabel(state) {
      try {
        const key = "workflow.stageState." + String(state);
        const label = dgT(key);
        return typeof label === "string" && label && label !== key ? label : String(state);
      } catch { return String(state); }
    }

    /**
     * 单条 active 工作流 → 可渲染模型；形状不符返回 null（调用方过滤掉）。
     * 宽容策略：stageIndex 缺失时按首个 active 阶段推导；stageCount 缺失时按 stages 长度；
     * status 越界按 active；stage.state 越界按 pending；stages 缺失 ⇒ 空数组（不渲染圆点行）。
     */
    function wfNormalizeEntry(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const goal = typeof raw.goal === "string" ? raw.goal : "";
      const id = typeof raw.id === "string" ? raw.id : "";
      const title = typeof raw.title === "string" ? raw.title : "";
      const stageId = typeof raw.stageId === "string" ? raw.stageId : "";
      const stageTitleRaw = typeof raw.stageTitle === "string" ? raw.stageTitle : "";
      const stages = (Array.isArray(raw.stages) ? raw.stages : [])
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : "",
          title: typeof s.title === "string" ? s.title : "",
          skill: typeof s.skill === "string" ? s.skill : "",
          lane: typeof s.lane === "string" ? s.lane : "",
          state: WF_STAGE_STATES.has(s.state) ? s.state : "pending",
        }));
      const countRaw = Math.floor(Number(raw.stageCount));
      const stageCount = Number.isFinite(countRaw) && countRaw > 0 ? countRaw : stages.length;
      const activeIndex = stages.findIndex((s) => s.state === "active");
      const indexRaw = Math.floor(Number(raw.stageIndex));
      const index = Number.isFinite(indexRaw) && indexRaw >= 0
        ? indexRaw
        : (activeIndex >= 0 ? activeIndex : 0);
      const stageIndex = Math.max(0, Math.min(index, Math.max(0, stageCount - 1)));
      const stageTitle = stageTitleRaw || stages[stageIndex]?.title || "";
      // 无任何可展示标识 ⇒ 视为无效条目
      if (!goal && !id && !title && !stageId && !stageTitle) return null;
      return {
        goal, id, title, stageId, stageTitle, stageIndex, stageCount,
        status: WF_STATUSES.has(raw.status) ? raw.status : "active",
        stages,
      };
    }

    /** 契约载荷 → active 条目数组；active 缺失/非数组/条目全无效 ⇒ 空数组（调用方不渲染）。 */
    function wfNormalizeActiveList(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
      if (!Array.isArray(payload.active)) return [];
      const out = [];
      for (const item of payload.active) {
        const entry = wfNormalizeEntry(item);
        if (entry) out.push(entry);
      }
      return out;
    }

    /** 条目阶段序号（缺失按 -1），用于「最新」排序。 */
    function wfStageIndexOf(entry) {
      const n = Math.floor(Number(entry?.stageIndex));
      return Number.isFinite(n) && n >= 0 ? n : -1;
    }

    /**
     * 「最新」条目：先按 status === "active" 优先，再按 stageIndex 大者优先，同序取数组靠前者。
     * 纯函数、确定性、不改入参顺序。
     */
    function wfHeadlineEntry(active) {
      let best = null;
      for (const entry of active) {
        if (!best) { best = entry; continue; }
        const entryRunning = entry.status === "active" ? 1 : 0;
        const bestRunning = best.status === "active" ? 1 : 0;
        if (entryRunning !== bestRunning) {
          if (entryRunning > bestRunning) best = entry;
          continue;
        }
        if (wfStageIndexOf(entry) > wfStageIndexOf(best)) best = entry;
      }
      return best;
    }

    /** 纯渲染（无 hooks）：抛错由调用方兜底成 null，绝不冒泡到会话头/看板。 */
    function wfRenderStrip(active) {
      const head = wfHeadlineEntry(active);
      if (!head) return null;
      const stageText = head.stageTitle || head.stageId || head.title || head.goal || dgT("workflow.unnamedStage");
      const position = head.stageCount > 0
        ? dgT("workflow.position", { index: head.stageIndex + 1, count: head.stageCount })
        : "";
      const goals = active.map((e) => e.goal || e.title || e.id).filter(Boolean).join(", ");
      const statusStyle = head.status === "completed"
        ? WF_STYLE.statusCompleted
        : (head.status === "blocked" ? WF_STYLE.statusBlocked : WF_STYLE.statusActive);
      return h("div", {
        className: "dg-workflow-strip",
        role: "status",
        title: goals ? dgT("workflow.tooltip", { goals }) : dgT("workflow.tooltipUnnamed"),
        "aria-label": dgT("workflow.aria", {
          stage: stageText, index: head.stageIndex + 1, count: head.stageCount,
        }),
        style: WF_STYLE.strip,
      },
        h("span", { style: WF_STYLE.label }, dgT("workflow.label")),
        h("span", { style: WF_STYLE.count }, dgT("workflow.count", { count: active.length })),
        head.title ? h("span", { style: WF_STYLE.title, title: head.title }, head.title) : null,
        h("span", { style: WF_STYLE.stage }, dgT("workflow.stage", { stage: stageText })),
        position ? h("span", { style: WF_STYLE.position }, position) : null,
        // 圆点行只在载荷带 stages（card 面/扩展载荷）时出现；workspace 级契约不带，故常规为空。
        head.stages.length
          ? h("span", { style: WF_STYLE.dots },
              head.stages.map((stage, i) => h("span", {
                key: stage.id || String(i),
                className: "dg-workflow-dot",
                "aria-hidden": "true",
                title: dgT("workflow.stageTooltip", {
                  title: stage.title || stage.skill || stage.id || dgT("workflow.unnamedStage"),
                  state: wfStageStateLabel(stage.state),
                }),
                style: { ...WF_STYLE.dot, ...wfDotStyle(stage.state) },
              }, WF_STAGE_GLYPH[stage.state] || "○")))
          : null,
        h("span", { style: { ...WF_STYLE.status, ...statusStyle } }, dgT("workflow.status." + head.status)),
      );
    }

    /**
     * WorkflowStrip(props)：紧凑工作流 chip（图标 + 条数 + 最新条目的阶段 + 第 n/m 步 + 状态）。
     * - 数据来源：props.activeWorkflows（显式投递数组，供 card 面 / 单测注入）优先；
     *   否则同源 GET graphUrl("/api/dsh-graph/workflows", {}, workspace)（**不带 goal 参数**）。
     * - 非 2xx / 非 JSON / active 缺失或空 / 无 workspace ⇒ 返回 null（不渲染任何东西）。
     */
    function WorkflowStrip(props) {
      useLocaleRevision();
      const injected = props && Object.prototype.hasOwnProperty.call(props, "activeWorkflows")
        ? props.activeWorkflows
        : undefined;
      const [fetched, setFetched] = React.useState(null);
      const sessionId = props?.sessionId ?? null;
      // workspace 解析顺序与 SupervisorHeaderBadge 同口径：props 显式值优先，
      // 再退回既有 resolveWorkspaceOfSession（g-223/g-244 的会话隔离链），绝不另立解析器。
      const workspace = (typeof props?.workspace === "string" && props.workspace)
        || (typeof props?.cwd === "string" && props.cwd)
        || (typeof resolveWorkspaceOfSession === "function" ? resolveWorkspaceOfSession(sessionId) : null)
        || null;
      React.useEffect(() => {
        let cancelled = false;
        if (injected !== undefined) { setFetched(null); return () => { cancelled = true; }; }
        setFetched(null);
        try {
          if (!workspace || typeof graphUrl !== "function" || typeof fetch !== "function") {
            return () => { cancelled = true; };
          }
          const url = graphUrl("/api/dsh-graph/workflows", {}, workspace);
          if (!url) return () => { cancelled = true; };
          fetch(url, { method: "GET", credentials: "same-origin" })
            .then((res) => (res && res.ok ? res.json().catch(() => null) : null))
            .then((payload) => { if (!cancelled) setFetched(wfNormalizeActiveList(payload)); })
            .catch(() => { if (!cancelled) setFetched(null); });
        } catch { if (!cancelled) setFetched(null); }
        return () => { cancelled = true; };
      }, [injected, workspace]);
      const active = injected !== undefined
        ? wfNormalizeActiveList({ active: Array.isArray(injected) ? injected : null })
        : (Array.isArray(fetched) && fetched.length ? fetched : null);
      if (!active || !active.length) return null;
      try { return wfRenderStrip(active); } catch { return null; }
    }
