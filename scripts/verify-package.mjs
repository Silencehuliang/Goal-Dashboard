#!/usr/bin/env node
// Independent verification, V1 + V2 (static manifest / artifact checks).
// Usage: node scripts/verify-package.mjs [repoRoot]
// Prints one line per assertion: "<ID> <PASS|FAIL|UNVERIFIED> <claim> :: <evidence>"
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = resolve(process.argv[2] ?? process.cwd());
const out = [];
const rec = (id, verdict, claim, evidence) => {
  out.push({ id, verdict, claim, evidence });
  console.log(`${id} ${verdict} ${claim} :: ${evidence}`);
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const rel = (p) => p.slice(repo.length + 1).replace(/\\/g, '/');

// ---------- V1: root package.json is an installable plugin manifest ----------
const pkgPath = join(repo, 'package.json');
let pkg;
try {
  pkg = readJson(pkgPath);
  rec('V1.0', 'PASS', 'root package.json parses as JSON', `name=${pkg.name} version=${pkg.version} bytes=${statSync(pkgPath).size} sha256=${sha256(pkgPath).slice(0, 16)}`);
} catch (e) {
  rec('V1.0', 'FAIL', 'root package.json parses as JSON', String(e.message));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

// name must not be the upstream one and must not be private
rec('V1.1', pkg.name === 'goal-dashboard' ? 'PASS' : 'FAIL', 'root package name is goal-dashboard', `name=${JSON.stringify(pkg.name)}`);
rec('V1.2', pkg.private === undefined ? 'PASS' : 'FAIL', 'root package is not private (installable)', `private=${JSON.stringify(pkg.private)}`);
rec('V1.3', pkg.version === '0.18.0' ? 'PASS' : 'FAIL', 'root version is 0.18.0', `version=${JSON.stringify(pkg.version)}`);

// every declared entry path must exist on disk
const entryPaths = [
  ['V1.4', 'main', pkg.main],
  ['V1.5', 'exports["."]', pkg.exports?.['.']],
  ['V1.6', 'exports["./client"]', pkg.exports?.['./client']],
  ['V1.7', 'exports["./cordis.patch.yml"]', pkg.exports?.['./cordis.patch.yml']],
  ['V1.8', 'exports["./package.json"]', pkg.exports?.['./package.json']],
  ['V1.9', 'dsh.bundle.patch', pkg.dsh?.bundle?.patch],
];
for (const [id, label, p] of entryPaths) {
  if (typeof p !== 'string') { rec(id, 'FAIL', `${label} declared and resolves to an existing file`, `declared=${JSON.stringify(p)}`); continue; }
  const abs = join(repo, p);
  rec(id, existsSync(abs) ? 'PASS' : 'FAIL', `${label} resolves to an existing file`, `${label}=${p} -> exists=${existsSync(abs)} size=${existsSync(abs) ? statSync(abs).size : 'n/a'}`);
}

// dsh.client shape
const dc = pkg.dsh?.client;
rec('V1.10', dc && dc.platform === 'web' && Array.isArray(dc.inject) && dc.inject.length > 0 ? 'PASS' : 'FAIL',
  'dsh.client declares platform=web + inject[]', `dsh.client=${JSON.stringify(dc)}`);

// prepare script must be absent (pnpm blocks git-hosted prepare)
rec('V1.11', pkg.scripts?.prepare === undefined ? 'PASS' : 'FAIL',
  'no scripts.prepare (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED avoidance)', `scripts.prepare=${JSON.stringify(pkg.scripts?.prepare)}`);

// engines.dsh must include the desktop host version 0.2.0-rc.2
const range = pkg.engines?.dsh;
const TARGET = '0.2.0-rc.2';
let satisfiesDefault = null, satisfiesPrerelease = null, semverSource = 'n/a';
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  let semver = null;
  for (const cand of ['semver', 'C:/Users/silence/.dsh/profiles/node_modules/semver', 'E:/Development/Env/nodejs/node_modules/@deepseek-ai/dsh/node_modules/semver']) {
    try { semver = req(cand); semverSource = cand; break; } catch { /* keep probing */ }
  }
  if (semver) {
    satisfiesDefault = semver.satisfies(TARGET, range);
    satisfiesPrerelease = semver.satisfies(TARGET, range, { includePrerelease: true });
    semverSource += ` (semver ${req(semverSource.endsWith('semver') ? semverSource + '/package.json' : semverSource).version ?? '?'})`;
  }
} catch (e) { semverSource = 'unavailable: ' + e.message; }
const enginesVerdict = satisfiesDefault === true ? 'PASS' : satisfiesDefault === false ? 'FAIL' : 'UNVERIFIED';
rec('V1.12', enginesVerdict, `engines.dsh range includes ${TARGET}`,
  `engines.dsh=${JSON.stringify(range)} satisfies(${TARGET})=${satisfiesDefault} satisfies(includePrerelease)=${satisfiesPrerelease} via ${semverSource}`);

// ---------- V2: artifacts ----------
const trackedDist = (() => {
  try { return execFileSync('git', ['ls-files', 'dist'], { cwd: repo, encoding: 'utf8' }).trim(); }
  catch (e) { return `git failed: ${e.message}`; }
})();
const trackedCount = trackedDist ? trackedDist.split(/\r?\n/).filter(Boolean).length : 0;
rec('V2.1', trackedCount > 0 ? 'PASS' : 'FAIL', 'dist/ is committed (git ls-files dist)', `tracked_files=${trackedCount} first=${trackedDist.split(/\r?\n/)[0] ?? '(none)'}`);

for (const [id, f] of [['V2.2', 'dist/index.js'], ['V2.3', 'dist/lib/client.js']]) {
  const abs = join(repo, f);
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    rec(id, 'PASS', `node --check ${f}`, `exit=0 size=${statSync(abs).size}`);
  } catch (e) {
    rec(id, 'FAIL', `node --check ${f}`, `exit=${e.status} stderr=${(e.stderr ?? '').toString().slice(0, 300)}`);
  }
}

// banner
const client = readFileSync(join(repo, 'dist/lib/client.js'), 'utf8');
const bannerOk = /GENERATED FILE/.test(client.slice(0, 400)) && /scripts\/build-client\.sh/.test(client.slice(0, 400));
rec('V2.4', bannerOk ? 'PASS' : 'FAIL', 'generated-client banner present at top of dist/lib/client.js', `head=${JSON.stringify(client.slice(0, 120))}`);

// client bundle id == package name
const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(client) ?? /id:\s*"([^"]+)"/.exec(client.slice(0, 800));
const bundleId = idMatch ? idMatch[1] : '(not found)';
rec('V2.5', bundleId === pkg.name ? 'PASS' : 'FAIL', 'client bundle loader id equals package name', `bundle_id=${bundleId} package_name=${pkg.name}`);

// dist/package.json consistency
try {
  const dp = readJson(join(repo, 'dist/package.json'));
  rec('V2.6', dp.name === pkg.name && dp.version === pkg.version ? 'PASS' : 'FAIL',
    'dist/package.json name+version equal root manifest', `dist.name=${dp.name} dist.version=${dp.version} root.name=${pkg.name} root.version=${pkg.version}`);
  rec('V2.7', dp.main === 'index.js' ? 'PASS' : 'FAIL', 'dist/package.json main points at index.js', `main=${JSON.stringify(dp.main)}`);
  const dpc = readFileSync(join(repo, 'dist/cordis.patch.yml'), 'utf8');
  const im = /name:\s*(\S+)/.exec(dpc);
  rec('V2.8', im && im[1] === pkg.name ? 'PASS' : 'FAIL', 'dist/cordis.patch.yml insert name equals package name', `insert_name=${im ? im[1] : '(none)'} text=${JSON.stringify(dpc.replace(/\s+/g, ' ').slice(0, 200))}`);
} catch (e) {
  rec('V2.6', 'FAIL', 'dist/package.json readable', String(e.message));
}

// dist byte-freshness vs sources: index.js copied from dsh-graph-host/index.js
const pairs = [['dsh-graph-host/index.js', 'dist/index.js'], ['dsh-graph-host/cordis.patch.yml', 'dist/cordis.patch.yml'], ['dsh-graph-host/README.md', 'dist/README.md']];
for (const [src, dst] of pairs) {
  const a = join(repo, src), b = join(repo, dst);
  if (!existsSync(a) || !existsSync(b)) { rec('V2.9', 'UNVERIFIED', `byte-fresh ${dst} vs ${src}`, 'missing source or dist file'); continue; }
  const same = sha256(a) === sha256(b);
  rec('V2.9', same ? 'PASS' : 'FAIL', `byte-fresh ${dst} vs ${src}`, `src=${sha256(a).slice(0, 16)} dist=${sha256(b).slice(0, 16)}`);
}
// compiled core freshness: dist/core/*.js newer than core/*.ts
const coreTs = readdirSync(join(repo, 'core')).filter((f) => f.endsWith('.ts'));
let stale = [];
for (const f of coreTs) {
  const js = join(repo, 'dist/core', f.replace(/\.ts$/, '.js'));
  if (!existsSync(js)) { stale.push(`${f}: no dist/core counterpart`); continue; }
  if (statSync(join(repo, 'core', f)).mtimeMs > statSync(js).mtimeMs) stale.push(`${f}: source newer than dist`);
}
rec('V2.10', stale.length === 0 ? 'PASS' : 'FAIL', 'every core/*.ts has a dist/core/*.js at least as new', `core_ts=${coreTs.length} stale=${JSON.stringify(stale)}`);

console.log('\nJSON ' + JSON.stringify(out, null, 2));
