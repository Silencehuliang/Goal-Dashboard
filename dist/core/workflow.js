/**
 * 目标维度的工作流运行态：把 core/skills.ts 的预设（preset）挂到某个目标上，并记录推进到哪一阶段。
 *
 * 契约（与 UI/REST 侧冻结，见 docs/skills-integration.md）：
 * - 运行态持久化在 **<goalDir>/workflow.json**（goalDir 由既有 core/ops.ts#findGoalFile 解析出的
 *   goal.md 所在目录决定；backlog 平铺文件没有目录，与建卡/attempt 的既有约定一致地拒绝）。
 * - 每次变更都追加到**既有** append-only 事件流 events.jsonl（core/events.ts#appendEvent）：
 *   `workflow.started` / `workflow.stage.advanced` / `workflow.completed`。不写第二份日志。
 * - workflow.json 是**物化投影**（含展示所需的排序/状态），events.jsonl 是可审计的第二事实源；
 *   从事件流重建投影目前未实现（见文档「尚未实现」）。
 * - 推进语义：一次只能前进一个阶段；重复推进到当前或已走过的阶段是**幂等 no-op**（不写文件、不落事件）；
 *   未知阶段与跳跃前进抛 GraphError。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { appendEvent, nowIso } from "./events.js";
import { GraphError } from "./machine.js";
import { findGoalFile } from "./ops.js";
import { replaceFileAtomic } from "./platform.js";
import { MATTPOCOCK_SKILLS, WORKFLOW_PRESETS, findPreset, skillCatalog, } from "./skills.js";
/** workflow.json 文件名（相对目标目录）。 */
export const WORKFLOW_FILE_NAME = "workflow.json";
/** workflow.json 结构版本；不匹配时拒绝读取（避免把未来格式当成本版解释）。 */
export const WORKFLOW_FILE_VERSION = 1;
/** 默认 actor（宿主适配层应显式传入真实 actor）。 */
export const DEFAULT_WORKFLOW_ACTOR = "agent:workflow";
export const WORKFLOW_EVENT_STARTED = "workflow.started";
export const WORKFLOW_EVENT_ADVANCED = "workflow.stage.advanced";
export const WORKFLOW_EVENT_COMPLETED = "workflow.completed";
/** goal.md 所在目录；与 core/ops.ts 私有 goalDirOf 同构（backlog 平铺文件无目录 → 明确拒绝）。 */
function goalDirOf(goalFile) {
    if (basename(goalFile) !== "goal.md") {
        throw new GraphError("暂存目标（backlog）没有目录，需先排期移入 goals/ 或版本后才能使用工作流");
    }
    return dirname(goalFile);
}
/** `<goalDir>/workflow.json` 的绝对路径（目标不存在时抛 GraphError）。 */
export function workflowFilePath(root, goalSlug) {
    return join(goalDirOf(findGoalFile(root, goalSlug)), WORKFLOW_FILE_NAME);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateRun(raw, file, where) {
    if (!isRecord(raw))
        throw new GraphError(`workflow.json ${where} 不是对象：${file}`);
    const stagesRaw = raw.stages;
    if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
        throw new GraphError(`workflow.json ${where} 缺少非空 stages：${file}`);
    }
    if (typeof raw.id !== "string" || typeof raw.preset !== "string") {
        throw new GraphError(`workflow.json ${where} 缺少 id/preset：${file}`);
    }
    if (typeof raw.stageIndex !== "number" || raw.stageIndex < 0 || raw.stageIndex >= stagesRaw.length) {
        throw new GraphError(`workflow.json ${where} 的 stageIndex 越界：${file}`);
    }
    const status = raw.status;
    if (status !== "active" && status !== "completed" && status !== "blocked") {
        throw new GraphError(`workflow.json ${where} 的 status 非法：${String(status)}`);
    }
    return raw;
}
function readStore(root, goalSlug) {
    const file = workflowFilePath(root, goalSlug);
    if (!existsSync(file)) {
        return { file, store: { version: WORKFLOW_FILE_VERSION, current: null, history: [] } };
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(file, "utf8"));
    }
    catch (e) {
        throw new GraphError(`workflow.json 不是合法 JSON：${file}（${e.message}）`);
    }
    if (!isRecord(raw))
        throw new GraphError(`workflow.json 顶层必须是对象：${file}`);
    if (raw.version !== WORKFLOW_FILE_VERSION) {
        throw new GraphError(`workflow.json 版本不支持：${String(raw.version)}（期望 ${WORKFLOW_FILE_VERSION}）：${file}`);
    }
    const historyRaw = Array.isArray(raw.history) ? raw.history : [];
    const history = historyRaw.map((h, i) => validateRun(h, file, `history[${i}]`));
    const current = raw.current === null || raw.current === undefined
        ? null
        : validateRun(raw.current, file, "current");
    return { file, store: { version: WORKFLOW_FILE_VERSION, current, history } };
}
function writeStore(file, store) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
        writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        replaceFileAtomic(tmp, file);
    }
    catch (e) {
        try {
            if (existsSync(tmp))
                rmSync(tmp, { force: true });
        }
        catch {
            // 清理失败不掩盖原始错误
        }
        throw e;
    }
}
function cloneRun(run) {
    return {
        ...run,
        stages: run.stages.map((s) => ({ ...s })),
        notes: run.notes.map((n) => ({ ...n })),
    };
}
function toStatusView(run) {
    const stage = run.stages[run.stageIndex] ?? null;
    return {
        id: run.id,
        title: run.title,
        stageId: stage ? stage.id : null,
        stageTitle: stage ? stage.title : null,
        lane: stage ? stage.lane : null,
        stageIndex: run.stageIndex,
        stageCount: run.stages.length,
        status: run.status,
        stages: run.stages.map((s) => ({ ...s })),
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
    };
}
function stageStateFrom(stage, index) {
    return {
        id: stage.id,
        title: stage.title,
        skill: stage.skill,
        lane: stage.lane,
        state: index === 0 ? "active" : "pending",
    };
}
/**
 * 为目标启动一次工作流（写入 <goalDir>/workflow.json + 追加 workflow.started 事件）。
 * - 未知预设 → GraphError；
 * - 已有 active 运行且未传 restart → GraphError（避免静默丢弃进度）；
 * - restart=true 或旧运行已 completed → 旧记录移入 history 后重开。
 */
export function startWorkflow(root, goalSlug, presetId, opts) {
    const preset = findPreset(presetId);
    if (!preset) {
        const ids = WORKFLOW_PRESETS.map((p) => p.id).join(" / ");
        throw new GraphError(`未知工作流预设：${presetId}（可选：${ids}）`);
    }
    if (preset.stages.length === 0)
        throw new GraphError(`工作流预设 ${presetId} 没有阶段`);
    const { file, store } = readStore(root, goalSlug);
    if (store.current && store.current.status === "active" && !opts?.restart) {
        throw new GraphError(`目标 ${goalSlug} 已有进行中的工作流 ${store.current.id}（预设 ${store.current.preset}）；` +
            "如需重开请传 restart=true");
    }
    const ts = nowIso();
    const run = {
        id: `wf-${randomUUID().slice(0, 8)}`,
        goal: goalSlug,
        preset: preset.id,
        title: preset.title,
        status: "active",
        stageIndex: 0,
        stages: preset.stages.map((s, i) => stageStateFrom(s, i)),
        notes: [],
        startedAt: ts,
        updatedAt: ts,
    };
    if (store.current)
        store.history.unshift(store.current);
    store.current = run;
    store.version = WORKFLOW_FILE_VERSION;
    writeStore(file, store);
    appendEvent(root, {
        actor: opts?.actor ?? DEFAULT_WORKFLOW_ACTOR,
        event: WORKFLOW_EVENT_STARTED,
        goal: goalSlug,
        details: {
            workflow_id: run.id,
            preset: run.preset,
            stage: run.stages[0].id,
            stage_count: run.stages.length,
        },
    });
    return toStatusView(run);
}
/**
 * 推进工作流。
 * - `to` 省略 → 下一阶段；`to` 指定阶段 id → 必须正好是下一阶段（跳跃抛 GraphError）；
 * - `to` 指向当前或已走过的阶段 → 幂等 no-op（返回现状，不写文件、不落事件）；
 * - 工作流不存在 / 已 completed|blocked → GraphError；
 * - 走到最后一个阶段时写 workflow.stage.advanced + workflow.completed 各一条。
 */
export function advanceWorkflow(root, goalSlug, opts) {
    const { file, store } = readStore(root, goalSlug);
    const run = store.current;
    if (!run) {
        throw new GraphError(`目标 ${goalSlug} 没有工作流，请先 startWorkflow`);
    }
    if (run.status !== "active") {
        throw new GraphError(`工作流 ${run.id} 状态为 ${run.status}，无法继续推进`);
    }
    const currentIndex = run.stageIndex;
    const requested = opts?.to === undefined || opts?.to === null ? "" : String(opts.to).trim();
    let targetIndex = currentIndex + 1;
    if (requested !== "") {
        const idx = run.stages.findIndex((s) => s.id === requested);
        if (idx < 0) {
            const ids = run.stages.map((s) => s.id).join(" / ");
            throw new GraphError(`未知阶段：${requested}（可选：${ids}）`);
        }
        targetIndex = idx;
    }
    // 幂等：目标就是当前阶段（或已走过的阶段）→ 不变更、不落事件
    if (targetIndex <= currentIndex)
        return toStatusView(run);
    if (targetIndex > currentIndex + 1) {
        const next = run.stages[currentIndex + 1];
        const skipped = run.stages[targetIndex];
        throw new GraphError(`不允许跳过阶段：当前 ${run.stages[currentIndex].id}，下一个只能是 ${next.id}（请求跳到 ${skipped.id}）`);
    }
    const from = run.stages[currentIndex];
    const next = run.stages[targetIndex];
    const ts = nowIso();
    from.state = "done";
    next.state = "active";
    run.stageIndex = targetIndex;
    const completing = targetIndex === run.stages.length - 1;
    if (completing) {
        next.state = "done";
        run.status = "completed";
    }
    const note = typeof opts?.note === "string" ? opts.note.trim() : "";
    if (note !== "")
        run.notes.push({ ts, text: note });
    run.updatedAt = ts;
    writeStore(file, store);
    const actor = opts?.actor ?? DEFAULT_WORKFLOW_ACTOR;
    appendEvent(root, {
        actor,
        event: WORKFLOW_EVENT_ADVANCED,
        goal: goalSlug,
        details: {
            workflow_id: run.id,
            preset: run.preset,
            from: from.id,
            to: next.id,
            stage_index: targetIndex,
            ...(note !== "" ? { note } : {}),
        },
    });
    if (completing) {
        appendEvent(root, {
            actor,
            event: WORKFLOW_EVENT_COMPLETED,
            goal: goalSlug,
            details: {
                workflow_id: run.id,
                preset: run.preset,
                stage: next.id,
                stage_count: run.stages.length,
            },
        });
    }
    return toStatusView(run);
}
/** 当前工作流视图；没有则 null（目标不存在时仍抛 GraphError，与其它 ops 一致）。 */
export function workflowStatus(root, goalSlug) {
    const { store } = readStore(root, goalSlug);
    return store.current ? toStatusView(store.current) : null;
}
/** 该目标的全部运行记录（当前在前，历史按新→旧）；没有则 []。 */
export function listWorkflows(root, goalSlug) {
    const { store } = readStore(root, goalSlug);
    const out = [];
    if (store.current)
        out.push(cloneRun(store.current));
    for (const h of store.history)
        out.push(cloneRun(h));
    return out;
}
/** 预设列表（深拷贝，防止调用方改动模块级常量）。 */
export function listPresets(presets = WORKFLOW_PRESETS) {
    return presets.map((p) => ({
        ...p,
        stages: p.stages.map((s) => ({ ...s })),
    }));
}
/**
 * 组装 GET /api/dsh-graph/workflow 的响应体（不含 workspace→root 解析，由适配层完成）。
 * 键与冻结契约完全一致：{goal, workflow, presets, catalog}。
 */
export function workflowApiPayload(root, goalSlug) {
    return {
        goal: goalSlug,
        workflow: workflowStatus(root, goalSlug),
        presets: listPresets(),
        catalog: skillCatalog(MATTPOCOCK_SKILLS),
    };
}
