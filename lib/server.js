/**
 * A tiny loopback-only HTTP server that serves the board — shell, assets, and a
 * small command API.
 *
 * Why this exists instead of using the host's web server:
 *
 * The DSH desktop app refuses to display its OWN origin inside its embedded
 * browser. Every guest navigation is gated by
 *
 *   allowedNavigation(url) => http(s) && no credentials && !isApplicationHost(url)
 *   isApplicationHost(url) => url.port === appPort
 *                          && hostname ∈ {app host, localhost, 127.0.0.1, [::1]}
 *
 * and the browser session cancels such requests outright. So a page served by
 * the host's own web server can never be opened in the embedded browser — that
 * is the meaning of the app's own message "不能在嵌入浏览器中打开 DSH 应用自身".
 *
 * Serving from a *different* loopback port satisfies that predicate, so the
 * board opens inside DSH.
 *
 * Write safety: the server is loopback-only, rejects non-loopback Host headers,
 * rejects cross-site Origin values, and requires `content-type: application/json`
 * on POST. That last one is load-bearing — it forces a CORS preflight, which a
 * cross-site page cannot satisfy against a server that returns no CORS headers,
 * so a random web page cannot drive the board behind the user's back.
 */

import { createServer } from "node:http";

import { readAsset } from "./assets.js";
import { renderBoardHtml } from "./board.js";

/** Preferred port when the caller does not pick one. */
export const DEFAULT_BOARD_PORT = 8931;

const MAX_BODY_BYTES = 256 * 1024;
const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostName(value) {
  const raw = String(value ?? "");
  if (raw.startsWith("[")) return raw.slice(0, raw.indexOf("]") + 1);
  return raw.replace(/:\d+$/, "");
}

/** The Host header must point at loopback: blocks DNS-rebinding style access. */
function hostAllowed(req) {
  return LOOPBACK_NAMES.has(hostName(req.headers.host));
}

/** An Origin, when present, must be loopback or the host app itself. */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return LOOPBACK_NAMES.has(url.hostname) || url.protocol === "dsh-app:";
  } catch {
    return false;
  }
}

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  res.end(body);
}

function json(res, code, value) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listen(server, port) {
  return new Promise((resolve) => {
    const onError = (error) => {
      server.off("listening", onListening);
      resolve({ ok: false, error });
    };
    const onListening = () => {
      server.off("error", onError);
      resolve({ ok: true, port: server.address().port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Route one request. Never throws out of the handler.
 *
 * @param deps.snapshot - (workspace|null) => state object for GET /api/state
 * @param deps.command - (cmd, payload, workspace|null) => result for POST /api/command
 */
async function handle(req, res, deps) {
  try {
    if (!hostAllowed(req) || !originAllowed(req)) {
      return json(res, 403, { error: "forbidden: this endpoint is loopback-only" });
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const workspace = url.searchParams.get("workspace");
    const method = req.method ?? "GET";

    if (method === "GET" || method === "HEAD") {
      const body = (text, type) => send(
        res, 200, type, method === "HEAD" ? undefined : text,
        // Being embedded by the host is the whole point, so framing is allowed;
        // nothing else is, and there is no inline script to allow.
        { "content-security-policy": "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors *" },
      );

      if (url.pathname === "/" || url.pathname === "/goal-dashboard") {
        return body(renderBoardHtml({ now: new Date().toISOString() }), "text/html; charset=utf-8");
      }
      if (url.pathname === "/app.css") return body(readAsset("app.css"), "text/css; charset=utf-8");
      if (url.pathname === "/app.js") return body(readAsset("app.js"), "text/javascript; charset=utf-8");
      if (url.pathname === "/api/state") return json(res, 200, deps.snapshot(workspace));
      return send(res, 404, "text/plain; charset=utf-8", "not found — the board is at /\n");
    }

    if (url.pathname === "/api/command") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const type = String(req.headers["content-type"] ?? "");
      if (!type.toLowerCase().startsWith("application/json")) {
        // The preflight-triggering content type is the CSRF defence; see the header note.
        return json(res, 415, { error: "content-type must be application/json" });
      }
      let parsed;
      try {
        parsed = JSON.parse(await readBody(req) || "{}");
      } catch (error) {
        return json(res, 400, { error: `bad request body: ${error?.message ?? error}` });
      }
      const cmd = typeof parsed?.cmd === "string" ? parsed.cmd : "";
      if (cmd.length === 0) return json(res, 400, { error: "missing cmd" });
      const result = await deps.command(cmd, parsed.payload ?? {}, workspace);
      return json(res, 200, result ?? { ok: true });
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    try {
      json(res, 400, { error: String(error?.message ?? error) });
    } catch {
      /* response already sent */
    }
  }
}

/**
 * Start the board server.
 *
 * @param options.port - `false`/`null` disables it; `0` asks the OS for a free
 *                       port; any other integer is preferred, with an automatic
 *                       ephemeral fallback if it is taken.
 * @param options.snapshot - (workspace|null) => state
 * @param options.command - (cmd, payload, workspace|null) => result
 * @returns {ok, url, port, error, disabled, close}
 */
export async function startBoardServer({ port, snapshot, command }) {
  if (port === false || port === null) {
    return { ok: false, disabled: true, close: () => {} };
  }
  const desired = Number.isInteger(port) && port >= 0 ? port : DEFAULT_BOARD_PORT;

  const server = createServer((req, res) => {
    handle(req, res, { snapshot, command }).catch(() => {
      /* handle() already reports its own failures */
    });
  });
  server.unref?.();

  let result = await listen(server, desired);
  if (!result.ok && desired !== 0 && result.error?.code === "EADDRINUSE") {
    result = await listen(server, 0);
  }
  if (!result.ok) {
    try { server.close(); } catch { /* already closed */ }
    return { ok: false, error: result.error, close: () => {} };
  }

  return {
    ok: true,
    port: result.port,
    url: `http://127.0.0.1:${result.port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
