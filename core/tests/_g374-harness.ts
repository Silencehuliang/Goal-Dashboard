// g-374 共用宿主桩：注册插件、捕获子代理派发请求、捕获 `subagent/end` 处理器、直连工具与 REST 路由。
//
// 为什么共用：F5（LLM 摘要通道 / 缓存 / 降级 / 归因红线）、F6（报文骨架）、F7（输入预算）三套断言
// 必须落在**同一个**宿主行为上；各写一份桩会让「归因红线」这类跨路径断言出现口径漂移。
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { init, createGoal, setCriteria, findGoalFile } from "../ops.ts";
import { apply } from "../../dist/index.js";

export function createHarness() {
  const ws = mkdtempSync(join(tmpdir(), "dsh-graph-g374-h-"));
  const root = join(ws, ".dsh-graph");
  init(root);
  const capturedRequests: any[] = [];
  const registeredTools: any[] = [];
  const routes: any[] = [];
  const handlers = new Map<string, Array<(info: any) => void>>();
  const webServer = { register: (r: any) => { routes.push(r); return () => {}; } };
  const ctx: any = {
    get: (name: string) => {
      if (name === "sandboxPolicy") return { workspaceRoot: ws };
      if (name === "agents") return { get: () => ({ id: "sess-super" }) };
      if (name === "webServer") return webServer;
      if (name === "subagents") {
        return {
          list: () => ["spawn"],
          getProvider: (n: string) => (n === "spawn" ? { prepareContinuable: () => {} } : {}),
          startContinuable: async (opts: any) => {
            capturedRequests.push(opts);
            return { childId: `child-${capturedRequests.length}`, parentSessionId: "sess-super" };
          },
        };
      }
      return undefined;
    },
    effect: (fn: () => unknown) => fn(),
    webServer,
    tools: { register: (def: any) => { registeredTools.push(def); return () => {}; }, get: () => ({}) },
    on: (evt: string, fn: (info: any) => void) => {
      const list = handlers.get(evt) ?? [];
      list.push(fn);
      handlers.set(evt, list);
      return () => {};
    },
  };
  apply(ctx, { root });
  const toolsByName = new Map(registeredTools.map((t: any) => [t.name, t]));
  const execContext = {
    agent: { id: "a1", session: { header: { cwd: ws }, id: "sess-exec" } },
    signal: new AbortController().signal,
  };
  const call = (name: string, args: any) => {
    const tool = toolsByName.get(name);
    assert.ok(tool, `工具未注册：${name}`);
    return tool.execute(args, execContext);
  };
  /** 触发宿主事件（如 `subagent/end`）。 */
  const emit = (evt: string, info: any) => {
    for (const fn of handlers.get(evt) ?? []) fn(info);
  };
  /** 子代理派发的 label 列表（用于「谁被派发了」的精确断言）。 */
  const labels = () => capturedRequests.map((r) => r?.label ?? "");
  return { ws, root, toolsByName, routes, call, emit, labels, capturedRequests, execContext, handlers };
}

export function prepare(h: ReturnType<typeof createHarness>, opts: { title?: string; description?: string } = {}) {
  writeFileSync(join(h.root, "project.yaml"), "supervisor:\n  session: sess-super\n", "utf8");
  const goal = createGoal(h.root, {
    title: opts.title ?? "F5 摘要", version: "v1.0", actor: "human:gui",
    ...(opts.description ? { description: opts.description } : {}),
  });
  setCriteria(h.root, goal, ["判据 1"], "human:gui");
  const goalFile = findGoalFile(h.root, goal);
  return { goal, goalFile, dir: dirname(goalFile) };
}

/** 派发一个 attempt 并返回 attempt id（同时会捕获 1 次子代理派发）。 */
export async function dispatch(h: ReturnType<typeof createHarness>, goal: string, brief = "做点事") {
  const res = await h.call("graph_start_attempt", { goal, attempt_brief: brief, task_type: "fix" });
  assert.ok(res?.attempt, "派发必须返回 attempt");
  return res.attempt as string;
}

/** 极简 REST 请求/响应桩（readBodyCapped 只用到 data/end/error 事件）。 */
export function restCall(route: any, body: any, method = "POST") {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
  req.method = method;
  req.url = route.path;
  req.headers = {};
  const res: any = {
    code: 0, payload: null,
    writeHead(code: number) { this.code = code; },
    end(text: string) { this.payload = JSON.parse(text); },
  };
  return route.handler(req, res).then(() => res);
}
