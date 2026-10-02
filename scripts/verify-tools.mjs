#!/usr/bin/env node
// Independent verification, V4 (static half): enumerate the tools the host half
// registers, from the SHIPPED artifact dist/index.js (not from a summary).
// Usage: node scripts/verify-tools.mjs [repoRoot]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(process.argv[2] ?? process.cwd());
const file = join(repo, 'dist', 'index.js');
const src = readFileSync(file, 'utf8');

/** Scan a balanced bracket region starting at `start` (index of the opening '['). */
function scanBalanced(text, start) {
  let depth = 0, i = start, mode = null;
  for (; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      if (c === '\\') { i++; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'sq'; continue; }
    if (c === '"') { mode = 'dq'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

const declIdx = src.indexOf('const tools = [');
let names = [], region = null, how = 'fallback';
if (declIdx >= 0) {
  const open = src.indexOf('[', declIdx);
  region = scanBalanced(src, open);
  how = 'balanced-scan from `const tools = [`';
  if (region) names = [...region.matchAll(/\bname:\s*"(graph_[A-Za-z0-9_]+)"/g)].map((m) => m[1]);
} else {
  names = [...src.matchAll(/\bname:\s*"(graph_[A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}
const unique = [...new Set(names)].sort();
const dupes = names.filter((n, i) => names.indexOf(n) !== i);

console.log(`file=${file} bytes=${Buffer.byteLength(src)} chars=${src.length}`);
console.log(`extraction=${how}`);
console.log(`tools declared in array literal : ${names.length} (unique ${unique.length})`);
console.log(`duplicate names in literal       : ${JSON.stringify([...new Set(dupes)])}`);
console.log(`first 5 : ${unique.slice(0, 5).join(', ')}`);
console.log(`last 5  : ${unique.slice(-5).join(', ')}`);
console.log(`\nALL ${unique.length} TOOL NAMES:`);
console.log(unique.join('\n'));

const want = ['graph_workflow_list', 'graph_workflow_start', 'graph_workflow_advance', 'graph_workflow_status', 'graph_skills_catalog'];
for (const w of want) console.log(`PRESENCE ${w}: ${unique.includes(w) ? 'PRESENT' : 'ABSENT (NOT YET WIRED)'}`);

const routes = [...src.matchAll(/path:\s*"(\/api\/dsh-graph[A-Za-z0-9_\-\/]*)"/g)].map((m) => m[1]);
console.log(`\nREST routes matching path: "/api/dsh-graph*" : ${routes.length} (unique ${new Set(routes).size})`);

const exportBlock = [...src.matchAll(/^export\s+(?:const|function|class|\{)([^\n]*)/gm)].map((m) => m[0]);
console.log(`export statements: ${exportBlock.length}`);
console.log(`has bare \`export default\`: ${/^\s*export\s+default\b/m.test(src)}`);
console.log(`export const name = ${/(?:^|\n)export const name = ([^;]+);/.exec(src)?.[1]}`);
console.log(`export const inject = ${/(?:^|\n)export const inject = ([^;]+);/.exec(src)?.[1]}`);

try {
  const mod = await import(pathToFileURL(file).href);
  console.log(`\ndynamic import of dist/index.js: OK; keys=${JSON.stringify(Object.keys(mod))}`);
  console.log(`  name=${JSON.stringify(mod.name)} inject=${JSON.stringify(mod.inject)} apply=${typeof mod.apply} Config=${typeof mod.Config}`);
} catch (e) {
  console.log(`\ndynamic import of dist/index.js: FAILED ${e.message}`);
}
