#!/usr/bin/env node
// Independent verification, V3 (HTTP half): against a RUNNING isolated DSH web host,
// prove the plugin is an enabled client row in the boot graph and that its bundle is served.
//
// Usage: node scripts/verify-activation.mjs <baseUrl> <token> <packageName> [outDir]
import { writeFileSync } from 'node:fs';

const [base, token, pkg, outDir = 'tmp/verify'] = process.argv.slice(2);
if (!base || !token || !pkg) {
  console.error('usage: node scripts/verify-activation.mjs <baseUrl> <token> <packageName> [outDir]');
  process.exit(2);
}

let cookie = '';
async function req(path, opts = {}) {
  // Accept absolute URLs, root-absolute paths, and document-relative ones
  // (0.2.0-rc.2 advertises "plugins/??…" with no leading slash and HTML-escaped "&amp;").
  const clean = String(path).replace(/&amp;/g, '&');
  const url = clean.startsWith('http') ? clean : `${base}${clean.startsWith('/') ? '' : '/'}${clean}`;
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await res.arrayBuffer());
  return { url, status: res.status, type: res.headers.get('content-type'), location: res.headers.get('location'), buf, setCookie: sc };
}

const first = await req(`/?token=${encodeURIComponent(token)}`);
console.log(`GET /?token -> ${first.status} location=${first.location} setCookie=${first.setCookie.length}`);
const second = await req('/');
console.log(`GET / (with cookie) -> ${second.status} ${second.type} bytes=${second.buf.length}`);
writeFileSync(`${outDir}/http-root.html`, second.buf);
const html = second.buf.toString('utf8');

const bootIdx = html.indexOf('__DSH_BOOT__');
console.log(`__DSH_BOOT__ present in served HTML: ${bootIdx >= 0}`);
const occurrences = (needle) => html.split(needle).length - 1;
console.log(`occurrences: ${JSON.stringify({ [pkg]: occurrences(pkg), 'dsh-graph': occurrences('dsh-graph') })}`);

// All advertised plugins URLs that mention the package (0.1.5-rc.3: "/plugins/…",
// 0.2.0-rc.2: document-relative "plugins/…").
const urls = [...new Set([...html.matchAll(/\/?plugins\/[^"'\s<>\\]+/g)].map((m) => m[0]))];
const mine = urls.filter((u) => u.includes(pkg));
console.log(`advertised /plugins URLs mentioning ${pkg}: ${mine.length}`);
for (const u of mine.slice(0, 6)) console.log(`  URL ${u.slice(0, 240)}`);

if (bootIdx >= 0) {
  const start = html.indexOf('{', bootIdx);
  const end = html.indexOf('</script>', start);
  const chunk = html.slice(start, end).trim().replace(/[;\s]+$/, '');
  try {
    const json = JSON.parse(chunk);
    writeFileSync(`${outDir}/boot-graph.json`, JSON.stringify(json, null, 2));
    console.log(`boot graph keys=${JSON.stringify(Object.keys(json))}`);
    const s = JSON.stringify(json);
    const idx = s.indexOf(pkg);
    console.log(`boot graph contains ${pkg}: ${idx >= 0}`);
    if (idx >= 0) console.log(`  ...${s.slice(Math.max(0, idx - 320), idx + 320)}...`);
    const row = (json.entries ?? []).find((e) => e.id === pkg);
    if (row) {
      // 0.1.5-rc.3 advertises root-absolute URLs ("/plugins/??…"); 0.2.0-rc.2 advertises
      // document-relative ones ("plugins/??…"). Resolve both against the document URL.
      const rowUrl = /^[a-z]+:\/\//i.test(row.url) ? row.url : `/${String(row.url).replace(/^\/+/, '')}`;
      console.log(`ROW id=${row.id} rev=${row.rev} raw_url=${row.url}`);
      console.log(`    resolved_url=${rowUrl} inject=${JSON.stringify(row.inject)} immediate=${row.immediately}`);
      const r = await req(rowUrl);
      console.log(`GET advertised row url -> ${r.status} ${r.type} bytes=${r.buf.length}`);
      if (r.status === 200 && /javascript/.test(r.type ?? '')) {
        writeFileSync(`${outDir}/http-client-${pkg}.js`, r.buf);
        const body = r.buf.toString('utf8');
        const idm = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(body);
        console.log(`  bundle loader id = ${idm ? idm[1] : '(not found)'} (expected ${pkg})`);
      }
      const bogus = rowUrl.replace(/rev=[^&]+/, 'rev=deadbeefdeadbeef-0');
      const rb = await req(bogus);
      console.log(`NEGATIVE CONTROL wrong rev -> ${rb.status} ${rb.type} bytes=${rb.buf.length}`);
      const unknown = await req(`/plugins/??no-such-plugin/client.js&rev=${row.rev}`);
      console.log(`NEGATIVE CONTROL unknown pkg -> ${unknown.status}`);
    } else {
      console.log(`NO ROW with id=${pkg} in boot graph entries`);
    }
  } catch (e) {
    console.log(`boot JSON parse failed: ${e.message}`);
  }
}

// Derived per-package bundle URL: keep the advertised rev.
const rev = /[?&]rev=([^&"'\s]+)/.exec(mine[0] ?? '')?.[1];
const candidates = [];
if (rev) candidates.push(`/plugins/${pkg}/client.js?rev=${rev}`);
candidates.push(`/plugins/${pkg}/client.js`);
if (mine[0]) candidates.push(mine[0]);
for (const c of candidates) {
  const r = await req(c);
  console.log(`GET ${c.slice(0, 160)} -> ${r.status} ${r.type} bytes=${r.buf.length}`);
  if (r.status === 200 && /javascript/.test(r.type ?? '')) {
    // This is the multi-package batch/server combo URL, NOT the single-package row bundle:
    // never overwrite the authoritative http-client-<pkg>.js written from the row URL.
    writeFileSync(`${outDir}/http-combo-${pkg}.js`, r.buf);
    const body = r.buf.toString('utf8');
    const ids = [...body.matchAll(/__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
    console.log(`  combo batch contains ${ids.length} loader ids, first=${ids[0]}, includes ${pkg}=${ids.includes(pkg)} (saved as http-combo-${pkg}.js)`);
  }
}

const ws = process.argv[6] ?? process.cwd();
const goal = process.argv[7] ?? 'g-001';
const api = await req(`/api/dsh-graph/workflow?workspace=${encodeURIComponent(ws)}&goal=${encodeURIComponent(goal)}`);
console.log(`GET /api/dsh-graph/workflow?workspace=<ws>&goal=${goal} -> ${api.status} ${api.type}`);
if (api.status === 200) {
  const j = JSON.parse(api.buf.toString('utf8'));
  console.log(`  keys=${JSON.stringify(Object.keys(j))} goal=${j.goal} workflow=${j.workflow ? `${j.workflow.id} stage=${j.workflow.stageId} ${j.workflow.stageIndex + 1}/${j.workflow.stageCount} status=${j.workflow.status} state=${j.workflow.stages.map((s) => s.state).join(',')}` : 'null'} presets=${j.presets?.length} catalog=${j.catalog?.length}`);
  writeFileSync(`${outDir}/http-workflow.json`, JSON.stringify(j, null, 2));
} else {
  console.log(`  body=${JSON.stringify(api.buf.toString('utf8').slice(0, 200))}`);
}
const list = await req(`/api/dsh-graph/workflows?workspace=${encodeURIComponent(ws)}`);
console.log(`GET /api/dsh-graph/workflows?workspace=<ws> -> ${list.status} ${list.type} body=${JSON.stringify(list.buf.toString('utf8').slice(0, 240))}`);
const missing = await req(`/api/dsh-graph/workflow?workspace=${encodeURIComponent(ws)}`);
console.log(`NEGATIVE CONTROL no goal param -> ${missing.status} body=${JSON.stringify(missing.buf.toString('utf8').slice(0, 120))}`);
