/**
 * Reads the browser assets that ship alongside the plugin.
 *
 * They are plain files rather than template strings so they can be read,
 * syntax-checked and diffed like normal code; they are never imported by Node.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const cache = new Map();

/** Read (and cache) one file from lib/client/. Throws if it is missing. */
export function readAsset(name) {
  if (!cache.has(name)) {
    cache.set(name, readFileSync(join(here, "client", name), "utf8"));
  }
  return cache.get(name);
}
