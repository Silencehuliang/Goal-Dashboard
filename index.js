/**
 * Goal Dashboard — a goal kanban board for DeepSeek Harness.
 *
 * Scope of this plugin, deliberately narrow:
 *   host half only. It registers tools and (optionally) one read-only HTTP route.
 *   It declares NO `dsh.client`, so the host never loads a browser bundle from
 *   this package and a defect here cannot prevent the DSH GUI from booting.
 *
 * Why that matters: the host's web boot aborts when any client entry fails to
 * activate, and a client entry fails to activate when a module in its inject
 * list is not present in the host's module set. That is exactly how an earlier
 * attempt at this plugin took the desktop GUI down (see README "为什么没有
 * 浏览器半边"). Keeping the UI on our own HTTP route removes that failure mode
 * entirely, at the cost of not appearing as an in-GUI tab.
 *
 * Contract followed: only the documented plugin surface —
 * `export const name`, `export const inject`, `export function apply(ctx, config)`,
 * `ctx.tools.register(...)`, `ctx.effect(...)`. No runtime `@deepseek-ai/*`
 * import, so the plugin cannot fail to load because a host package moved.
 */

import {
  BoardError, GOAL_TYPES, STATUSES, allCriteriaVerified, criteriaItems,
} from "./lib/model.js";
import {
  addNote, advanceWorkflow, appendEvent, boardSnapshot, createGoal, ensureBoard,
  listGoals, markCriterion, readGoal, resolveBoardRoot, setArchived, setCriteria,
  startWorkflow, transitionGoal, validateBoard,
} from "./lib/store.js";
import { WORKFLOW_PRESETS, skillCatalog, skillCategories } from "./lib/skills.js";
import { renderBoardHtml } from "./lib/board.js";

export const name = "goal-dashboard";
export const inject = ["tools"];

const text = (s) => [{ type: "text", text: s }];
const objOut = {
  schema: { type: "object" },
  render: (_args, value) => text(JSON.stringify(value, null, 2)),
};
const str = { type: "string" };
const strArr = { type: "array", items: { type: "string" } };
const bool = { type: "boolean" };
const num = { type: "number" };

/** Strict parameter whitelist — unknown fields are rejected by the host. */
function params(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Compact goal projection used by list/detail tools. */
function summarize(goal) {
  const items = criteriaItems(goal);
  return {
    goal: goal.id,
    title: goal.title,
    type: goal.type,
    status: goal.status,
    archived: goal.archived === true,
    blockedFrom: goal.blockedFrom ?? null,
    blockReason: goal.blockReason ?? null,
    criteria: items.map((c) => `${c.verified ? "[已验] " : "[待验] "}${c.text}`),
    criteriaVerified: allCriteriaVerified(goal),
    notes: (goal.notes ?? []).length,
    workflow: goal.workflow
      ? {
          preset: goal.workflow.presetId,
          status: goal.workflow.status,
          stageIndex: goal.workflow.stageIndex,
          stageCount: goal.workflow.stages.length,
          stage: goal.workflow.stages[goal.workflow.stageIndex]?.id ?? null,
          skill: goal.workflow.stages[goal.workflow.stageIndex]?.skill ?? null,
        }
      : null,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

export function apply(ctx, config) {
  const configRoot = typeof config?.root === "string" ? config.root : undefined;

  /** The workspace this call belongs to. Absolute config.root wins over it. */
  const workspaceOf = (exec) =>
    exec?.agent?.session?.header?.cwd ?? ctx.get?.("sandboxPolicy")?.workspaceRoot ?? null;

  const rootOf = (exec) => {
    const root = resolveBoardRoot(workspaceOf(exec), configRoot);
    ensureBoard(root);
    return root;
  };

  /** Who performed the action, recorded on every event. */
  const actorOf = (exec) => `agent:${exec?.agent?.id ?? "dsh"}`;

  const tools = [
    {
      def: {
        name: "board_create_goal",
        description:
          "在看板上创建一个目标（初始状态 draft）。返回目标 id，后续所有工具都用这个 id。type 可选 feature/bug/task/improvement/patch/chore，默认 task。",
        parameters: params(
          { title: str, type: { type: "string", enum: [...GOAL_TYPES] }, description: str },
          ["title"],
        ),
      },
      run: (a, ex) => summarize(createGoal(rootOf(ex), { title: a.title, type: a.type, description: a.description }, actorOf(ex))),
    },
    {
      def: {
        name: "board_list_goals",
        description:
          "列出看板上的目标（默认不含已归档）。可按 status（draft/planning/collecting/ready/in_progress/review/delivered/blocked）或 type 过滤。",
        parameters: params(
          { status: { type: "string", enum: [...STATUSES] }, type: { type: "string", enum: [...GOAL_TYPES] }, includeArchived: bool },
          [],
        ),
      },
      run: (a, ex) => ({
        goals: listGoals(rootOf(ex), { status: a.status, type: a.type, includeArchived: a.includeArchived === true }).map(summarize),
      }),
    },
    {
      def: {
        name: "board_show_goal",
        description: "查看单个目标的完整信息：状态、判据、备注历史与工作流进度。",
        parameters: params({ goal: str }, ["goal"]),
      },
      run: (a, ex) => summarize(readGoal(rootOf(ex), a.goal)),
    },
    {
      def: {
        name: "board_set_criteria",
        description:
          "登记/替换目标的质量判据（判据先于执行：进入 in_progress 前必须至少有一条判据）。criteria 为字符串数组；verified 可选，列出本次即视为已核验的判据原文。",
        parameters: params({ goal: str, criteria: strArr, verified: strArr }, ["goal", "criteria"]),
      },
      run: (a, ex) => summarize(setCriteria(rootOf(ex), a.goal, a.criteria, actorOf(ex), { verified: a.verified })),
    },
    {
      def: {
        name: "board_mark_criterion",
        description: "把某条判据标记为已核验（verified=true）或撤销核验（verified=false）。criterion 用判据原文或其唯一前缀定位。",
        parameters: params({ goal: str, criterion: str, verified: bool }, ["goal", "criterion"]),
      },
      run: (a, ex) => summarize(markCriterion(rootOf(ex), a.goal, a.criterion, a.verified !== false, actorOf(ex))),
    },
    {
      def: {
        name: "board_transition",
        description:
          "目标状态迁移，由状态机强制：draft→planning|blocked；planning→collecting|ready|in_progress|blocked；collecting→ready|planning|in_progress|blocked；ready→in_progress|collecting|blocked；in_progress→review|collecting|blocked；review→delivered|in_progress|blocked；delivered→review。进入 blocked 必须给 reason，且只能解除回原状态。",
        parameters: params(
          { goal: str, to: { type: "string", enum: [...STATUSES] }, reason: str, force: bool },
          ["goal", "to"],
        ),
      },
      run: (a, ex) => summarize(transitionGoal(rootOf(ex), a.goal, a.to, { reason: a.reason, force: a.force === true }, actorOf(ex))),
    },
    {
      def: {
        name: "board_add_note",
        description: "给目标追加一条可追溯的备注（历史讨论、决策、失败原因等），进入目标历史并落事件流。",
        parameters: params({ goal: str, text: str }, ["goal", "text"]),
      },
      run: (a, ex) => summarize(addNote(rootOf(ex), a.goal, a.text, actorOf(ex))),
    },
    {
      def: {
        name: "board_archive_goal",
        description: "归档目标（archived=true，默认从看板隐藏但数据保留）或恢复（archived=false）。不删除任何文件。",
        parameters: params({ goal: str, archived: bool }, ["goal"]),
      },
      run: (a, ex) => summarize(setArchived(rootOf(ex), a.goal, a.archived !== false, actorOf(ex))),
    },
    {
      def: {
        name: "board_workflow_start",
        description: `给目标挂上一个 skills 工作流预设。可选：${WORKFLOW_PRESETS.map((p) => p.id).join(" / ")}。目标已有进行中的工作流时会拒绝，除非 restart=true。`,
        parameters: params({ goal: str, preset: str, restart: bool }, ["goal", "preset"]),
      },
      run: (a, ex) => summarize(startWorkflow(rootOf(ex), a.goal, a.preset, actorOf(ex), { restart: a.restart === true })),
    },
    {
      def: {
        name: "board_workflow_advance",
        description:
          "把目标的工作流推进到下一阶段（或用 to 指定下一阶段，跳跃会被拒绝）。重复推进已走过的阶段是幂等 no-op。走到最后阶段会自动标记 completed。",
        parameters: params({ goal: str, to: str, note: str }, ["goal"]),
      },
      run: (a, ex) => summarize(advanceWorkflow(rootOf(ex), a.goal, { to: a.to, note: a.note }, actorOf(ex))),
    },
    {
      def: {
        name: "board_workflow_status",
        description: "查看目标的工作流进度：预设、当前阶段、每个阶段的状态（done/active/pending）与对应技能。没有工作流时 workflow 为 null。",
        parameters: params({ goal: str }, ["goal"]),
      },
      run: (a, ex) => {
        const goal = readGoal(rootOf(ex), a.goal);
        if (!goal.workflow) return { goal: goal.id, workflow: null };
        const wf = goal.workflow;
        return {
          goal: goal.id,
          workflow: {
            preset: wf.presetId,
            title: wf.title,
            status: wf.status,
            stageIndex: wf.stageIndex,
            stageCount: wf.stages.length,
            stages: wf.stages.map((s, i) => ({
              id: s.id,
              title: s.title,
              skill: s.skill,
              lane: s.lane,
              state: i < wf.stageIndex ? "done" : i === wf.stageIndex ? "active" : "pending",
            })),
          },
        };
      },
    },
    {
      def: {
        name: "board_skills_catalog",
        description: "列出内置的 mattpocock/skills 技能目录（名称 / 分类 / 调用方式 / 描述），可用 category 过滤。同时返回可用的工作流预设。",
        parameters: params({ category: str }, []),
      },
      run: (a) => ({
        skills: skillCatalog({ category: a.category }),
        categories: skillCategories(),
        presets: WORKFLOW_PRESETS.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          stages: p.stages.map((s) => `${s.id}:${s.skill}@${s.lane}`),
        })),
      }),
    },
    {
      def: {
        name: "board_validate",
        description: "校验看板不变式（状态合法性、判据门禁、工作流下标），返回问题列表；空数组表示健康。",
        parameters: params({}, []),
      },
      run: (_a, ex) => {
        const root = rootOf(ex);
        const problems = validateBoard(root);
        return { root, healthy: problems.length === 0, problems };
      },
    },
    {
      def: {
        name: "board_help",
        description: "输出 Goal Dashboard 的使用说明：工具清单、生命周期、判据门禁与工作流用法。",
        parameters: params({}, []),
      },
      run: () => ({
        about: "Goal Dashboard —— 把工作组织成目标看板的 DSH 插件（host 半边）。",
        lifecycle: STATUSES.join(" → "),
        invariant: "判据先于执行：进入 in_progress 前必须至少登记一条判据。",
        presets: WORKFLOW_PRESETS.map((p) => p.id),
        data: "<workspace>/.goal-board/（goals/<slug>.json + 只追加 events.jsonl）",
        tools: tools.map((t) => t.def.name),
      }),
    },
  ];

  return ctx.effect(() => {
    const disposers = tools.map((t) =>
      ctx.tools.register({
        name: t.def.name,
        description: t.def.description,
        parameters: t.def.parameters,
        output: objOut,
        execute: (args, exec) => {
          try {
            return t.run(args ?? {}, exec);
          } catch (error) {
            // Surface a clean, actionable message to the model instead of a stack trace.
            if (error instanceof BoardError) throw new Error(`[goal-dashboard] ${error.message}`);
            throw error;
          }
        },
      }),
    );

    // Optional: serve the read-only board page over the host's web server.
    //
    // `webServer` is contributed by the web-app bundle and may activate AFTER
    // apply(), so it is polled with a bounded, lazily-armed retry rather than
    // assumed. If it never appears (a headless composition) the tools remain the
    // whole interface and nothing is reported as an error.
    const routeState = { registered: false, timer: null };
    const registerBoardRoute = () => {
      if (routeState.registered) return true;
      const webServer = ctx.get?.("webServer");
      if (!webServer || typeof webServer.register !== "function") return false;
      try {
        const off = webServer.register({
          path: "/goal-dashboard",
          handler: (req, res) => {
            try {
              const url = new URL(req?.url ?? "/", "http://localhost");
              const root = resolveBoardRoot(
                url.searchParams.get("workspace") ?? ctx.get?.("sandboxPolicy")?.workspaceRoot ?? null,
                configRoot,
              );
              const html = renderBoardHtml(boardSnapshot(root), { now: new Date().toISOString() });
              res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
              res.end(html);
            } catch (error) {
              res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
              res.end(`goal-dashboard: ${error?.message ?? error}\n`);
            }
          },
        });
        if (typeof off === "function") disposers.push(off);
        routeState.registered = true;
        return true;
      } catch {
        return false;
      }
    };

    if (!registerBoardRoute()) {
      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (registerBoardRoute() || attempts >= 20) {
          routeState.timer = null;
          return;
        }
        routeState.timer = setTimeout(tick, 250);
      };
      routeState.timer = setTimeout(tick, 250);
      disposers.push(() => {
        if (routeState.timer) clearTimeout(routeState.timer);
      });
    }

    process.stderr.write(
      `[goal-dashboard] apply: ${tools.length} tools registered` +
        (routeState.registered ? " + /goal-dashboard board route" : " (webServer not ready; board route pending/absent)") +
        "\n",
    );

    return () => {
      for (const off of disposers) {
        try { off?.(); } catch { /* ignore */ }
      }
    };
  });
}
