#!/usr/bin/env node
// Independent verification, V5: spot-check the bundled mattpocock/skills catalog
// in core/skills.ts against the REAL SKILL.md files under _ref/skills.
//
// This script does NOT reuse the product's parser for the reference side: it
// re-parses the frontmatter itself, so a bug shared by both sides cannot hide.
//
// Usage: node scripts/verify-skills-catalog.mjs [repoRoot] [refRoot]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(process.argv[2] ?? process.cwd());
const refRoot = resolve(process.argv[3] ?? join(repo, '..', '_ref', 'skills'));
const skillsRoot = join(refRoot, 'skills');

// ---- reference side: our own minimal YAML frontmatter reader -----------------
function frontmatter(text) {
  const t = text.replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line !== line.trimStart()) continue;
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = JSON.parse(v);
    else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/''/g, "'");
    fm[m[1]] = v;
  }
  return fm;
}

function walkSkillFiles(dir, depth = 0, acc = []) {
  if (depth > 8 || !existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkSkillFiles(full, depth + 1, acc);
    else if (e.isFile() && e.name === 'SKILL.md') acc.push(full);
  }
  return acc;
}

const files = walkSkillFiles(skillsRoot).sort();
const refByKey = new Map(); // "<category>/<name>" -> {name, description, disable, file, category}
const refByName = new Map();
for (const f of files) {
  const rel = f.slice(skillsRoot.length + 1).split(/[\\/]/); // [category, name, SKILL.md]
  const fm = frontmatter(readFileSync(f, 'utf8'));
  if (!fm) { console.log(`REF-PARSE-FAIL ${f}`); continue; }
  const rec = { name: fm.name, description: fm.description ?? '', disable: String(fm['disable-model-invocation'] ?? ''), file: f, category: rel[0] };
  refByKey.set(`${rel[0]}/${rel[1]}`, rec);
  refByName.set(rec.name, rec);
}

// ---- product side -----------------------------------------------------------
const skillsTs = join(repo, 'core', 'skills.ts');
const mod = await import(pathToFileURL(skillsTs).href);
const { MATTPOCOCK_SKILLS, MATTPOCOCK_SKILLS_COUNT, WORKFLOW_PRESETS, validateWorkflowPresets } = mod;
const { STATUSES } = await import(pathToFileURL(join(repo, 'core', 'machine.ts')).href);

console.log('=== COUNTS ===');
console.log(`reference SKILL.md files on disk : ${files.length}`);
console.log(`MATTPOCOCK_SKILLS.length         : ${MATTPOCOCK_SKILLS.length}`);
console.log(`MATTPOCOCK_SKILLS_COUNT          : ${MATTPOCOCK_SKILLS_COUNT}`);
console.log(`machine STATUSES                 : ${JSON.stringify(STATUSES)}`);
console.log(`WORKFLOW_PRESETS                 : ${WORKFLOW_PRESETS.length} (${WORKFLOW_PRESETS.map((p) => p.id).join(', ')})`);

console.log('\n=== PER-ENTRY SPOT-CHECK (name + description must be byte-identical to the SKILL.md) ===');
let mismatch = 0, missingFile = 0;
for (const e of MATTPOCOCK_SKILLS) {
  const key = `${e.category}/${e.name}`;
  const ref = refByKey.get(key);
  if (!ref) {
    missingFile++;
    console.log(`MISSING-FILE ${key} :: no SKILL.md at ${key}`);
    continue;
  }
  const nameOk = ref.name === e.name;
  const descOk = ref.description === e.description;
  const invOk = (e.invocation === 'user') === (ref.disable.toLowerCase() === 'true');
  if (!nameOk || !descOk || !invOk) {
    mismatch++;
    console.log(`MISMATCH ${key}`);
    console.log(`   name   product=${JSON.stringify(e.name)} ref=${JSON.stringify(ref.name)} ok=${nameOk}`);
    console.log(`   desc   ok=${descOk}`);
    if (!descOk) {
      console.log(`     product=${JSON.stringify(e.description)}`);
      console.log(`     ref    =${JSON.stringify(ref.description)}`);
    }
    console.log(`   invocation product=${e.invocation} ref.disable-model-invocation=${JSON.stringify(ref.disable)} ok=${invOk}`);
  }
}
const catalogKeys = new Set(MATTPOCOCK_SKILLS.map((e) => `${e.category}/${e.name}`));
const uncovered = [...refByKey.keys()].filter((k) => !catalogKeys.has(k));
const duplicateNames = MATTPOCOCK_SKILLS.map((e) => e.name).filter((n, i, a) => a.indexOf(n) !== i);
console.log(`\nentries=${MATTPOCOCK_SKILLS.length} mismatched=${mismatch} missing-file=${missingFile} ref-not-in-catalog=${uncovered.length} duplicate-names=${JSON.stringify([...new Set(duplicateNames)])}`);
if (uncovered.length) console.log(`REF-NOT-IN-CATALOG: ${uncovered.join(', ')}`);

console.log('\n=== PRESET INTEGRITY (validateWorkflowPresets) ===');
const problems = validateWorkflowPresets();
console.log(problems.length === 0 ? 'no problems reported' : problems.join('\n'));
for (const p of WORKFLOW_PRESETS) {
  const bad = p.stages.filter((s) => !STATUSES.includes(s.lane)).map((s) => s.id);
  const unknown = p.stages.filter((s) => !MATTPOCOCK_SKILLS.some((e) => e.name === s.skill)).map((s) => s.skill);
  console.log(`preset ${p.id}: stages=${p.stages.length} lanes=${p.stages.map((s) => s.lane).join('>')} badLanes=${JSON.stringify(bad)} unknownSkills=${JSON.stringify(unknown)}`);
}

console.log('\n=== SPOT-CHECK 3 ENTRIES AGAINST RAW FILE TEXT (independent grep) ===');
for (const name of ['to-spec', 'code-review', 'grill-me']) {
  const e = MATTPOCOCK_SKILLS.find((x) => x.name === name);
  const f = refByName.get(name);
  if (!e || !f) { console.log(`SPOT ${name}: NOT FOUND (product=${!!e} ref=${!!f})`); continue; }
  const raw = readFileSync(f.file, 'utf8');
  const descLine = raw.split(/\r?\n/).find((l) => l.startsWith('description:'));
  console.log(`SPOT ${name} :: file=${f.file.slice(refRoot.length + 1)}`);
  console.log(`  raw line    : ${descLine}`);
  console.log(`  product desc: ${JSON.stringify(e.description)}`);
  console.log(`  equal-to-raw: ${raw.includes(`description: "${e.description}"`) || raw.includes(`description: ${e.description}`)}`);
  console.log(`  file mtime  : ${statSync(f.file).mtime.toISOString()}`);
}
