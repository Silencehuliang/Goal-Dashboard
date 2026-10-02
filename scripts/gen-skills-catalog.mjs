/**
 * Regenerate lib/skills-catalog.json from a real mattpocock/skills checkout.
 *
 * The catalogue is derived metadata only (name / category / invocation /
 * description) — no skill bodies are vendored. Re-run this when upstream adds
 * or renames skills:
 *
 *   git clone --depth 1 https://github.com/mattpocock/skills /tmp/skills
 *   node scripts/gen-skills-catalog.mjs /tmp/skills lib/skills-catalog.json
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: node scripts/gen-skills-catalog.mjs <skills-repo> <out.json>");
  process.exit(2);
}

const skillsRoot = join(src, "skills");
if (!existsSync(skillsRoot)) {
  console.error(`not a mattpocock/skills checkout (no skills/ directory): ${src}`);
  process.exit(2);
}

/** Minimal YAML frontmatter reader — enough for the flat key: value block upstream uses. */
function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

const entries = [];
for (const category of readdirSync(skillsRoot).sort()) {
  const categoryDir = join(skillsRoot, category);
  if (!statSync(categoryDir).isDirectory()) continue;
  for (const dir of readdirSync(categoryDir).sort()) {
    const skillFile = join(categoryDir, dir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const fields = frontmatter(readFileSync(skillFile, "utf8"));
    entries.push({
      name: fields.name || dir,
      category,
      invocation: fields["disable-model-invocation"] === "true" ? "user" : "model",
      description: (fields.description || "").replace(/\s+/g, " ").trim(),
    });
  }
}

entries.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(entries, null, 2) + "\n");

const counts = {};
for (const entry of entries) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
console.log(`wrote ${entries.length} skills -> ${out}`);
console.log("categories:", JSON.stringify(counts));
const missing = entries.filter((e) => !e.description).map((e) => e.name);
console.log("missing descriptions:", missing.length ? missing.join(", ") : "none");
