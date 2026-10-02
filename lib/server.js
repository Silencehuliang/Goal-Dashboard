/**
 * A tiny loopback-only HTTP server that serves the board page.
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
 * board opens inside DSH. The server is bound to 127.0.0.1 only, is read-only,
 * and can be disabled by setting `boardPort` to 0.
 */

import { createServer } from "node:http";

/** Serve one request. Never throws out of the request handler. */
function handle(req, res, render) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("method not allowed\n");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/" && url.pathname !== "/goal-dashboard") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found — the board is at /\n");
      return;
    }
    const workspace = url.searchParams.get("workspace");
    const html = render(workspace);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Explicitly frameable: the whole point is to be embedded by the host.
      "x-frame-options": "ALLOWALL",
      "content-security-policy": "frame-ancestors *",
    });
    res.end(req.method === "HEAD" ? undefined : html);
  } catch (error) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end(`goal-dashboard: ${error?.message ?? error}\n`);
  }
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

/** Preferred port when the caller does not pick one. */
export const DEFAULT_BOARD_PORT = 8931;

/**
 * Start the board server.
 *
 * @param options.port - `false`/`null` disables the server; `0` asks the OS for a
 *                       free port; any other integer is preferred (with an
 *                       automatic ephemeral fallback if it is taken).
 * @param options.render - (workspace|null) => html string
 * @returns {ok, url, port, error, disabled, close}
 */
export async function startBoardServer({ port, render }) {
  if (port === false || port === null) {
    return { ok: false, disabled: true, close: () => {} };
  }
  const desired = Number.isInteger(port) && port >= 0 ? port : DEFAULT_BOARD_PORT;

  const server = createServer((req, res) => handle(req, res, render));
  server.unref?.();

  let result = await listen(server, desired);
  // A taken port must not cost the user the feature: fall back to an ephemeral one.
  if (!result.ok && desired !== 0 && result.error?.code === "EADDRINUSE") {
    result = await listen(server, 0);
  }
  if (!result.ok) {
    try { server.close(); } catch { /* already closed */ }
    return { ok: false, error: result.error, close: () => {} };
  }

  const url = `http://127.0.0.1:${result.port}/`;
  return {
    ok: true,
    port: result.port,
    url,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
