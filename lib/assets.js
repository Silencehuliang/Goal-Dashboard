/**
 * Reads the browser assets that ship alongside the plugin.
 *
 * They are plain files rather than template strings so they can be read,
 * syntax-checked and diffed like normal code; they are never imported by Node.
 *
 * Deliberately NOT cached: host-half code changes need a DSH restart (Node's ESM
 * cache is per-process), and caching these would drag the page assets into the
 * same penalty. Reading two small files per request is cheap and means a CSS or
 * client-script fix only needs a page refresh.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Read one file from lib/client/. Throws if it is missing. */
export function readAsset(name) {
  const safe = /^[a-z0-9._-]+$/i.test(name) ? name : "";
  if (safe.length === 0) throw new Error(`unsafe asset name: ${name}`);
  return readFileSync(join(here, "client", safe), "utf8");
}
