/**
 * mattpocock/skills 目录（catalog）与工作流预设（preset）。
 *
 * 纯 TS、零 DSH 依赖：只依赖 node:fs / node:path 与状态机常量（core/machine.ts）。
 *
 * 背景：Goal-Dashboard 把 https://github.com/mattpocock/skills 的工作流接入看板：
 * - `MATTPOCOCK_SKILLS`：上游 skill 的**名称 / 分类 / 调用方式 / 描述**清单；description 逐字取自
 *   上游每个 SKILL.md 的 YAML frontmatter，来源标注为 `mattpocock/skills (MIT)`。
 *   **只打包 frontmatter 元数据，不打包 skill 正文**——正文仍随上游仓库（MIT）分发。
 * - `WORKFLOW_PRESETS`：把若干 skill 串成有序阶段（stage），每个阶段声明它落在看板的哪条泳道
 *   （lane = core/machine.ts 的 Status）。预设是「路线图」，**不自动迁移目标状态**（见 docs/skills-integration.md）。
 * - `scanSkillsDir`：扫描本地目录树中的 SKILL.md，用于按需扩展目录（缺目录/坏文件都不抛错）。
 *
 * 上游事实（编写本文件时 `_ref/skills` clone 的实测值）：37 个 SKILL.md
 *   （engineering 20 / in-progress 6 / misc 4 / productivity 7），其中 22 个
 *   `disable-model-invocation: true`（仅用户可调用）。早先计划里写的「39 个」是估计值，
 *   磁盘上实为 37 个；差异记录在 docs/skills-integration.md 的「已知偏差」小节。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { STATUSES } from "./machine.js";
/** 上游来源标注（MIT）：所有 MATTPOCOCK_SKILLS 条目的出处。 */
export const MATTPOCOCK_SKILLS_SOURCE = "mattpocock/skills (MIT)";
export const MATTPOCOCK_SKILLS_LICENSE = "MIT";
export const MATTPOCOCK_SKILLS_UPSTREAM = "https://github.com/mattpocock/skills";
/** frontmatter / 文档格式错误（与 GraphError 分开：这是解析层错误，不是状态机违例）。 */
export class SkillParseError extends Error {
}
const FRONTMATTER_DELIM = "---";
const CATEGORY_FALLBACK = "uncategorized";
const SKILL_FILE_NAME = "SKILL.md";
const DISABLE_KEY = "disable-model-invocation";
function normalizeNewlines(text) {
    return text.replace(/\r\n?/g, "\n");
}
/** 解码 YAML 标量：双引号（含 \" \\ \n 转义）、单引号（'' 表示字面单引号）、裸标量（去尾随注释）。 */
function decodeYamlScalar(raw) {
    const value = raw.trim();
    if (value.startsWith('"')) {
        let out = "";
        let i = 1;
        while (i < value.length) {
            const ch = value[i];
            if (ch === "\\" && i + 1 < value.length) {
                const next = value[i + 1];
                if (next === "n")
                    out += "\n";
                else if (next === "t")
                    out += "\t";
                else if (next === "r")
                    out += "\r";
                else
                    out += next;
                i += 2;
                continue;
            }
            if (ch === '"')
                break;
            out += ch;
            i += 1;
        }
        return out;
    }
    if (value.startsWith("'")) {
        let out = "";
        let i = 1;
        while (i < value.length) {
            const ch = value[i];
            if (ch === "'" && value[i + 1] === "'") {
                out += "'";
                i += 2;
                continue;
            }
            if (ch === "'")
                break;
            out += ch;
            i += 1;
        }
        return out;
    }
    // 裸标量：YAML 注释从「空白 + #」开始
    const comment = value.search(/\s#/);
    return (comment >= 0 ? value.slice(0, comment) : value).trim();
}
function yamlBool(raw) {
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "on" || v === "1";
}
/**
 * 解析 SKILL.md 的 YAML frontmatter，返回 name / description / disableModelInvocation。
 * 只认**顶格**键（`metadata:` 之类嵌套块内的同名键不会覆盖），缺 name 或无 frontmatter 时抛 SkillParseError。
 */
export function parseSkillFrontmatter(text) {
    const lines = normalizeNewlines(text).split("\n");
    if (lines.length === 0 || lines[0].trim() !== FRONTMATTER_DELIM) {
        throw new SkillParseError(`缺少 YAML frontmatter 起始分隔符 ${FRONTMATTER_DELIM}`);
    }
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === FRONTMATTER_DELIM) {
            end = i;
            break;
        }
    }
    if (end < 0) {
        throw new SkillParseError(`缺少 YAML frontmatter 结束分隔符 ${FRONTMATTER_DELIM}`);
    }
    const values = new Map();
    for (let i = 1; i < end; i++) {
        const line = lines[i];
        if (line.trim() === "" || line.trimStart().startsWith("#"))
            continue;
        if (line !== line.trimStart())
            continue; // 嵌套块内缩进行不参与顶层键解析
        const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
        if (!m)
            continue;
        values.set(m[1], decodeYamlScalar(m[2]));
    }
    const name = (values.get("name") ?? "").trim();
    if (name === "")
        throw new SkillParseError("frontmatter 缺少 name");
    const description = (values.get("description") ?? "").trim();
    const rawDisable = values.get(DISABLE_KEY) ?? values.get(DISABLE_KEY.replace(/-/g, "_")) ?? "";
    return { name, description, disableModelInvocation: yamlBool(rawDisable) };
}
function pathSegments(p) {
    return p.split(/[\\/]+/).filter((s) => s !== "");
}
/**
 * 从路径推导分类：优先取最后一个 `skills` 段之后的那一段（`…/skills/<category>/<name>/SKILL.md`），
 * 否则退回文件向上第三段，再退回 `uncategorized`。
 */
function deriveCategory(sourcePath) {
    const segs = pathSegments(sourcePath);
    const skillsIdx = segs.lastIndexOf("skills");
    if (skillsIdx >= 0 && segs.length - skillsIdx >= 4)
        return segs[skillsIdx + 1];
    if (segs.length >= 3)
        return segs[segs.length - 3];
    return CATEGORY_FALLBACK;
}
/** 解析一份 SKILL.md 文档为目录条目（name/category/invocation/description/path）。 */
export function parseSkillDocument(text, sourcePath) {
    const fm = parseSkillFrontmatter(text);
    return {
        name: fm.name,
        category: deriveCategory(sourcePath),
        invocation: fm.disableModelInvocation ? "user" : "model",
        description: fm.description,
        path: sourcePath,
    };
}
function byCategoryThenName(a, b) {
    if (a.category !== b.category)
        return a.category < b.category ? -1 : 1;
    if (a.name !== b.name)
        return a.name < b.name ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
/**
 * 递归扫描 root 下的全部 `SKILL.md`，解析为目录条目。
 * 容错契约：root 不存在/不可读 → `[]`；单个文件解析失败 → 跳过该文件（不抛错）。
 * 跳过点目录与 node_modules；返回按 (category, name, path) 稳定排序。
 */
export function scanSkillsDir(root) {
    if (!root || !existsSync(root))
        return [];
    const files = [];
    const walk = (dir, depth) => {
        if (depth > 8)
            return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full, depth + 1);
            }
            else if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
                files.push(full);
            }
        }
    };
    walk(root, 0);
    files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out = [];
    for (const file of files) {
        try {
            out.push(parseSkillDocument(readFileSync(file, "utf8"), file));
        }
        catch {
            // 单个坏文件不中断扫描（目录容错是显式契约）
        }
    }
    out.sort(byCategoryThenName);
    return out;
}
/** 目录条目 → 契约形状（name/category/invocation/description）。 */
export function skillCatalog(entries = MATTPOCOCK_SKILLS) {
    return entries.map((e) => ({
        name: e.name,
        category: e.category,
        invocation: e.invocation,
        description: e.description,
    }));
}
export function findSkill(name, entries = MATTPOCOCK_SKILLS) {
    for (const e of entries) {
        if (e.name === name)
            return e;
    }
    return null;
}
export function findPreset(id, presets = WORKFLOW_PRESETS) {
    for (const p of presets) {
        if (p.id === id)
            return p;
    }
    return null;
}
/**
 * 结构化校验预设与目录的一致性（供测试与宿主自检复用）：
 * 每个 preset 阶段引用的 skill 必须存在于 catalog，lane 必须是合法机器状态，
 * 同一 preset 内阶段 id 唯一，preset id 唯一。返回问题列表（空数组 = 全部通过）。
 */
export function validateWorkflowPresets(presets = WORKFLOW_PRESETS, catalog = MATTPOCOCK_SKILLS) {
    const problems = [];
    const skillNames = new Set(catalog.map((s) => s.name));
    const presetIds = new Set();
    for (const preset of presets) {
        if (presetIds.has(preset.id))
            problems.push(`预设 id 重复：${preset.id}`);
        presetIds.add(preset.id);
        if (preset.stages.length === 0)
            problems.push(`预设 ${preset.id} 没有阶段`);
        const stageIds = new Set();
        for (const stage of preset.stages) {
            if (stageIds.has(stage.id))
                problems.push(`预设 ${preset.id} 阶段 id 重复：${stage.id}`);
            stageIds.add(stage.id);
            if (!skillNames.has(stage.skill)) {
                problems.push(`预设 ${preset.id} 阶段 ${stage.id} 引用了目录外的 skill：${stage.skill}`);
            }
            if (!STATUSES.includes(stage.lane)) {
                problems.push(`预设 ${preset.id} 阶段 ${stage.id} 的 lane 不是合法状态：${stage.lane}`);
            }
        }
    }
    return problems;
}
/**
 * mattpocock/skills 的打包目录（frontmatter 元数据）。
 * 由 `_ref/skills` clone 的 37 个 SKILL.md 逐条生成，description 逐字一致、未做改写。
 */
const MATTPOCOCK_SKILLS_RAW = [
    // @@CATALOG_BEGIN@@
    { name: "ask-matt", category: "engineering", invocation: "user", description: "Ask which skill or flow fits your situation. A router over the skills in this repo." },
    { name: "code-review", category: "engineering", invocation: "model", description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"." },
    { name: "codebase-design", category: "engineering", invocation: "model", description: "Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary." },
    { name: "diagnosing-bugs", category: "engineering", invocation: "model", description: "Diagnosis loop for hard bugs and performance regressions. Use when the user says \"diagnose\"/\"debug this\", or reports something broken/throwing/failing/slow." },
    { name: "domain-modeling", category: "engineering", invocation: "model", description: "Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a GLOSSARY.md, or recording or editing an ADR." },
    { name: "grill-with-docs", category: "engineering", invocation: "user", description: "A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go." },
    { name: "implement-spec", category: "engineering", invocation: "user", description: "Implement the result of /to-spec and /to-tickets in code." },
    { name: "implement", category: "engineering", invocation: "user", description: "Implement a piece of work based on a spec or set of tickets." },
    { name: "improve-codebase-architecture", category: "engineering", invocation: "user", description: "Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick." },
    { name: "pr", category: "engineering", invocation: "model", description: "Use when writing a PR body." },
    { name: "prototype", category: "engineering", invocation: "model", description: "Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like." },
    { name: "research", category: "engineering", invocation: "model", description: "Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent." },
    { name: "retro", category: "engineering", invocation: "user", description: "Conduct a retrospective on a coding session." },
    { name: "setup-matt-pocock-skills", category: "engineering", invocation: "user", description: "Configure this repo for the engineering skills: set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills." },
    { name: "tdd", category: "engineering", invocation: "model", description: "Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions \"red-green-refactor\", or wants integration tests." },
    { name: "to-spec", category: "engineering", invocation: "user", description: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed." },
    { name: "to-tickets", category: "engineering", invocation: "user", description: "Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker)." },
    { name: "triage", category: "engineering", invocation: "user", description: "Move issues and external PRs through a state machine of triage roles, categorise, verify, grill if needed, and write agent-ready briefs." },
    { name: "wayfinder", category: "engineering", invocation: "user", description: "Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear." },
    { name: "wizard", category: "engineering", invocation: "model", description: "Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself." },
    { name: "claude-handoff", category: "in-progress", invocation: "user", description: "Hand the current conversation off to a fresh background agent that picks up the work immediately." },
    { name: "loop-me", category: "in-progress", invocation: "user", description: "Grill me about specs for the workflows I want to build, within this workspace." },
    { name: "setup-ts-deep-modules", category: "in-progress", invocation: "user", description: "Wire dependency-cruiser into a TypeScript repo so each package is a deep module, with implementation hidden in subfolders and reachable only through its entry-point files. User-invoked." },
    { name: "writing-beats", category: "in-progress", invocation: "user", description: "Writing, exploit; assemble raw material into a journey of beats, grounding each term before a beat leans on it." },
    { name: "writing-fragments", category: "in-progress", invocation: "user", description: "Writing, explore: mine raw fragments, no structure yet." },
    { name: "writing-shape", category: "in-progress", invocation: "user", description: "Writing, exploit: shape raw material into an article, paragraph by paragraph." },
    { name: "git-guardrails-claude-code", category: "misc", invocation: "model", description: "Set up Claude Code hooks to block dangerous git commands (push, reset --hard, clean, branch -D, etc.) before they execute. Use when user wants to prevent destructive git operations, add git safety hooks, or block git push/reset in Claude Code." },
    { name: "migrate-to-shoehorn", category: "misc", invocation: "model", description: "Migrate test files from `as` type assertions to @total-typescript/shoehorn. Use when user mentions shoehorn, wants to replace `as` in tests, or needs partial test data." },
    { name: "scaffold-exercises", category: "misc", invocation: "model", description: "Create exercise directory structures with sections, problems, solutions, and explainers that pass linting. Use when user wants to scaffold exercises, create exercise stubs, or set up a new course section." },
    { name: "setup-pre-commit", category: "misc", invocation: "model", description: "Set up Husky pre-commit hooks with lint-staged (Prettier), type checking, and tests in the current repo. Use when user wants to add pre-commit hooks, set up Husky, configure lint-staged, or add commit-time formatting/typechecking/testing." },
    { name: "grill-me", category: "productivity", invocation: "user", description: "A relentless interview to sharpen a plan or design." },
    { name: "grilling", category: "productivity", invocation: "model", description: "Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases." },
    { name: "handoff", category: "productivity", invocation: "user", description: "Compact the current conversation into a handoff document for another agent to pick up." },
    { name: "teach", category: "productivity", invocation: "user", description: "Teach the user a new skill or concept, within this workspace." },
    { name: "to-questionnaire", category: "productivity", invocation: "user", description: "Turn a decision you can't fully answer into a questionnaire for someone else to fill in." },
    { name: "wait-what", category: "productivity", invocation: "user", description: "Stop. That last message did not land: re-pitch it." },
    { name: "writing-for-agents", category: "productivity", invocation: "model", description: "Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md." },
    // @@CATALOG_END@@
];
/** 打包目录：上游相对 path（`skills/<category>/<name>/SKILL.md`，非本地可解析路径）。 */
export const MATTPOCOCK_SKILLS = MATTPOCOCK_SKILLS_RAW.map((s) => ({
    name: s.name,
    category: s.category,
    invocation: s.invocation,
    description: s.description,
    path: `skills/${s.category}/${s.name}/${SKILL_FILE_NAME}`,
}));
/** 打包目录中的条目数（供自检/文档引用，避免各处硬编码数字）。 */
export const MATTPOCOCK_SKILLS_COUNT = MATTPOCOCK_SKILLS.length;
/**
 * 工作流预设：把 skill 串成有序阶段。
 * lane 说明「该阶段进行时目标应处的看板泳道」，只作展示/建议，不自动迁移目标状态。
 */
export const WORKFLOW_PRESETS = [
    {
        id: "engineering-feature",
        title: "Engineering feature: idea → ship",
        description: "上游主流程：先用 grill-with-docs 把想法问透并留下 ADR/术语表，再合成 spec、拆 tracer-bullet 工单，" +
            "实现后双轴评审，最后写 PR。",
        stages: [
            { id: "grill", title: "Grill the idea (docs trail)", skill: "grill-with-docs", lane: "planning" },
            { id: "spec", title: "Synthesize the spec", skill: "to-spec", lane: "collecting" },
            { id: "tickets", title: "Break into tracer-bullet tickets", skill: "to-tickets", lane: "ready" },
            { id: "implement", title: "Implement the ticket frontier", skill: "implement", lane: "in_progress" },
            { id: "review", title: "Two-axis code review", skill: "code-review", lane: "review" },
            { id: "pr", title: "Write the PR body", skill: "pr", lane: "delivered" },
        ],
    },
    {
        id: "bugfix",
        title: "Bugfix: diagnose → TDD → review",
        description: "先为 bug 建一条能变红的反馈回路并定位根因，再以 red → green 修复，最后双轴评审。",
        stages: [
            { id: "diagnose", title: "Build a feedback loop and diagnose", skill: "diagnosing-bugs", lane: "planning" },
            { id: "fix", title: "Fix test-first (red → green)", skill: "tdd", lane: "in_progress" },
            { id: "review", title: "Two-axis code review", skill: "code-review", lane: "review" },
        ],
    },
    {
        id: "spec-first",
        title: "Spec-first: interview → spec → implement",
        description: "轻量入口：没有代码工作目录时用 grill-me 把设计问透，再合成 spec 并直接实现（不拆工单）。",
        stages: [
            { id: "grill", title: "Relentless interview", skill: "grill-me", lane: "planning" },
            { id: "spec", title: "Synthesize the spec", skill: "to-spec", lane: "collecting" },
            { id: "implement", title: "Implement the spec", skill: "implement-spec", lane: "in_progress" },
            { id: "review", title: "Two-axis code review", skill: "code-review", lane: "review" },
        ],
    },
    {
        id: "spike",
        title: "Spike: prototype → research → TDD",
        description: "用一次性原型回答「状态模型/界面该长什么样」，用后台 agent 查一手资料，落定后用 TDD 固化。",
        stages: [
            { id: "prototype", title: "Throwaway prototype", skill: "prototype", lane: "planning" },
            { id: "research", title: "Primary-source research", skill: "research", lane: "collecting" },
            { id: "harden", title: "Harden test-first", skill: "tdd", lane: "in_progress" },
            { id: "review", title: "Two-axis code review", skill: "code-review", lane: "review" },
        ],
    },
    {
        id: "architecture-deepening",
        title: "Architecture: deepen modules",
        description: "扫描深化机会并选定一个，借 codebase-design 的深模块词汇重新设计，再走 spec → 工单 → 实现 → 评审。",
        stages: [
            { id: "scan", title: "Scan deepening opportunities", skill: "improve-codebase-architecture", lane: "planning" },
            { id: "design", title: "Design the deep module", skill: "codebase-design", lane: "planning" },
            { id: "grill", title: "Grill the design (docs trail)", skill: "grill-with-docs", lane: "collecting" },
            { id: "tickets", title: "Break into tickets", skill: "to-tickets", lane: "ready" },
            { id: "implement", title: "Implement", skill: "implement", lane: "in_progress" },
            { id: "review", title: "Two-axis code review", skill: "code-review", lane: "review" },
        ],
    },
];
