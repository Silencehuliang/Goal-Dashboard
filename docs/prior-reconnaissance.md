> ## ⚠️ SUPERSEDED — read the corrections before trusting this report
>
> This reconnaissance was written **before** the Goal-Dashboard fork existed, and before the
> Electron host could be read. Its structure, its loading recipes and most of its file-level
> citations are still accurate and useful. But four facts below are wrong or stale. Corrected:
>
> | Claim in this report | Correct value | How it was established |
> |---|---|---|
> | §8 — "Desktop profile runs **DSH 0.1.5-rc.3**" | The **desktop app bundles `@deepseek-ai/dsh` 0.2.0-rc.2** (app package `@deepseek-ai/dsh-desktop` 0.2.0-rc.2). `0.1.5-rc.3` is the **global CLI** at `E:\Development\Env\nodejs` — a different installation. | Read the `app.asar` header and extracted `/dsh/node_modules/@deepseek-ai/dsh/package.json` |
> | "49 tools" throughout | **54** tools (49 upstream + 5 `graph_workflow_*` / `graph_skills_catalog`). The `apply()`-derived guards now assert 54 across all six surfaces. | `core/tests/g371-readme-tool-table.test.ts`, `core/tests/g347-help-asset-guard.test.ts` |
> | "npm package name `dsh-graph`" | Renamed to **`goal-dashboard`**. Deliberately unchanged: `graph_*` tool names, `/api/dsh-graph*` REST paths, the `.dsh-graph` data directory, the `dsh-graph-host` internal plugin id, and the `dsh-graph` settings/locale namespace. | `package.json`, `dist/cordis.patch.yml` |
> | §9 checklist item 10 — "Ship prebuilt JS, or document `allowBuilds`" | **Done, the first way.** `dist/` is committed and the root package *is* the plugin manifest, so installation executes no build script at all. This is what removes the `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` failure. | `README.md` install section, `package.json` (no `prepare` script) |
>
> The original text is preserved unedited below, including the parts that are now stale — it is
> kept as a historical record of the state of the repository before the fork.
>
> ---
# dsh-graph v0.17.0 鈥?reconnaissance report

**Source of truth for this report:** read-only clone at `C:\Users\silence\AppData\Local\Temp\dsh-graph-ref`
(`github.com/miuzel/dsh-graph`, v0.17.0), plus the *built* package installed at
`C:\Users\silence\.dsh\profiles\desktop\node_modules\dsh-graph\` and the DSH 0.1.5-rc.3 runtime at
`C:\Users\silence\.dsh\profiles\node_modules\@deepseek-ai\`.

Every claim below is read from a file; anything inferred is labelled **[inferred]**.
The clone was not modified.

---

## 1. Architecture at a glance

Three layers, one direction of dependency: `core/` (pure TS) 鈫?`dsh-graph-host/` (DSH adapter) 鈫?`dist/` (published artifact).

| Layer | Role | Files / size | Evidence |
|---|---|---|---|
| `core/*.ts` | **Single source of truth.** Zero-dependency TS library, no DSH imports, no `node_modules` deps except `yaml`. Owns the state machine, entity model, events, transactions, REST schemas, git/worktree logic. Runnable directly by Node 26 type-stripping inside the repo. | 14 files, 13,368 lines (`ops.ts` alone 9,391 lines, ~150 exported functions) | `README.md:93`; `tsconfig.json:15`; module headers in `core/*.ts` |
| `dsh-graph-host/` | **Published package source** (npm name `dsh-graph`, directory name kept as `dsh-graph-host`). Host half = cordis plugin (`index.js`), client half = browser sources (`lib/client/*.js`), plus prompts/i18n/manifest. | `index.js` 4,375 lines; `lib/client/*.js` 26 files / 15,766 lines; `lib/server-i18n.js` 131; `prompts/*.md` 14 files | `README.md:94`; `dsh-graph-host/package.json:1-65` |
| `dist/` | **Build output = the thing that ships.** `dist/core/*.js` (tsc output), `dist/lib/client.js` (concatenated bundle), `dist/index.js` (verbatim copy), `dist/package.json` (generated), `prompts/`, `cordis.patch.yml`. Gitignored. | published `index.js` 224,652 B; `core/ops.js` 442,771 B; `lib/client.js` 891,817 B | `scripts/build.sh:84-108`; `.gitignore` (`dist/`); installed package listing |

### How a `.ts` core ends up inside a published JS package

1. `scripts/sync-core.sh:25-28` runs `tsc -p tsconfig.json --outDir <CORE_DIST>` 鈫?`core-dist/*.js`.
   `tsconfig.json:6-7` sets `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so the
   core's own `.ts` relative imports (`import 鈥?from "./ops.ts"`) are rewritten to `./ops.js` in the output.
2. `scripts/sync-core.sh:30-35` copies `core-dist/*.js` 鈫?`<DIST_DIR>/core/`, then asserts **no `.ts` leaked** (`:37-41`).
3. `index.js:156-158` imports the *compiled* siblings: `from "./core/ops.js"`, `"./core/root.js"`, `"./core/events.js"`.
   In the published package `dist/core/*.js` sits next to `dist/index.js`, so the same relative specifier resolves.
4. Why `.ts` cannot simply ship: Node's native type-stripping is **hard-disabled under `node_modules`**
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) 鈥?spelled out at `scripts/sync-core.sh:5-7`. Repo-local `.ts` runs
   fine, an installed `.ts` never does. Hence "prepack must run the compiler".

### Build step: `scripts/build.sh` (148 lines)

| Step | What | Lines |
|---|---|---|
| 0 | `mktemp -d .dist-stage.XXXXXX` staging root **on the same filesystem** as `dist/` (so the final swap is a rename, not a copy); `EXIT` trap cleans up | `:52-62` |
| 1 | `DIST_DIR=<stage>/dist CORE_DIST=<stage>/core-dist bash scripts/sync-core.sh` | `:73-74` |
| 2 | `DIST_DIR=<stage>/dist bash scripts/build-client.sh` | `:77-78` |
| 3 | copy non-generated assets (`index.js`, `lib/server-i18n.js`, `cordis.patch.yml`, `LICENSE`, `README.md`, `prompts/`, supervisor guides) and generate `dist/package.json` by deleting `scripts` and adding `main`+`exports` | `:84-108` |
| 4 | **Atomic publish**: first build `mv stage/dist dist`; otherwise `mv -T --exchange` (renameat2 `RENAME_EXCHANGE`, GNU coreutils 鈮?9.6) 鈥?one syscall, readers see either the whole old tree or the whole new tree; fallback = two renames with a stderr warning | `:112-132` |
| 5 | source-tree hygiene: remove the pre-g-319 legacy artifact paths `dsh-graph-host/core/` and `dsh-graph-host/lib/client.js` | `:135-140` |

The atomicity is not theoretical: `scripts/build.sh:15-21` records that the old `rm -rf dist`-first flow
made live readers hit `ENOENT` (`dsh-graph prompt asset missing or unreadable: guide-hint.zh.md`) and
**killed two in-flight worker attempts (g-346 att-001/att-002)**. The runtime reads `prompts/*.md` from
`dist/` on every call.

`scripts/build-client.sh` is a **concatenation**, not a bundler: a hard-coded `PARTS` array of 26 modules
(`:17-64`), a generated-file banner (`:67-72`), then `cat` each part with `sed '/>>>ESM-EXPORTS-START>>>/,/<<<ESM-EXPORTS-END<<</d'`
to strip test-only export blocks (`:75-83`). Order is semantic: modules that must live in the *factory*
scope (`search-state`, `board-retain`, `narrow-width`, `search-groups`, `version-drawer`, `batch-accept`)
must precede `drag-prompts.js`, which opens the `KanbanView` function body 鈥?putting them after would nest
them inside `KanbanView` and change React component identity on every render (`:31-56`).

---

## 2. Host contract (server side)

### Registration shape (cordis plugin, named exports only)

| Item | Location |
|---|---|
| `export const name = "dsh-graph-host"` | `index.js:230` |
| `export const inject = ["tools"]` | `index.js:233` (only hard dependency; `webServer` is *optional* and polled) |
| `export function apply(ctx, config)` | `index.js:1001` |
| `export { graphSettingsConfig as Config }` | `index.js:343` (optional schemastery schema for the newer host's settings-form projection) |
| **No `export default`** | stated as a hard rule at `index.js:10`; rationale in `docs/plugin-loading-recipe.md:186-189` (Loader's `unwrapExports` collapses to `default` and loses `inject`) |
| Runtime `@deepseek-ai/*` imports: **none** | `index.js:160-169`; `schemastery` is resolved with `createRequire` probing over `import.meta.url`, `process.argv[1]` and its realpath (`index.js:318-337`) |

### `engines.dsh`

`dsh-graph-host/package.json:28-31`:

```json
"engines": { "node": ">=22", "dsh": ">=0.1.5-rc.2 <0.2.1-0" }
```

Plus optional peers `@deepseek-ai/cordis ^4.0.2`, `@deepseek-ai/schemastery ^3.18.2`,
`@deepseek-ai/dsh-settings >=0.1.5-rc.2 <0.2.1-0` all marked `optional: true` (`:32-47`) 鈥?declared so the
desktop/CLI fallback symlink farm resolves the host's own copy, but a missing peer never blocks load.
**[inferred]** `engines.dsh` is a *manifest declaration* consumed by marketplaces/prechecks (`CHANGELOG.md:20`
says exactly that: "for dsh-market 鈥?card display and install/update precheck"); the cordis Loader itself
does not enforce it 鈥?nothing in the loader path reads `engines`.

### 49 tools

* Declared as a literal array `const tools = [{def:{name,description,parameters}, run:(args, exec)=>鈥, 鈥`
  starting at `index.js:1750-1751`; first entry `graph_create_goal` at `:1752-1759`.
* Registration happens **inside** `return ctx.effect(() => { 鈥?})` at `index.js:4166`:

```js
const disposers = tools.map((t) =>
  ctx.tools.register({
    ...t.def,
    description: sT(`tool.${t.def.name}`, toolLanguage),   // server-i18n, zh/en
    output: objOut,                                        // { schema:{type:"object"}, render() }
    execute: (args, exec) => t.run(args, exec),
  }),
);
```
  (`index.js:4190-4197`; `objOut` at `:236-239`; strict parameter whitelist helper `params()` with
  `additionalProperties:false` at `:345-348`.)
* Teardown: the returned closure clears timers, closes watchers, invalidates the board cache and runs every
  disposer (`index.js:4367-4373`).
* 49 is asserted by a machine guard, not by convention: `core/tests/g347-help-asset-guard.test.ts`
  ("A1 schema 鎭颁负 49 涓?graph_* 宸ュ叿"), and `g371-readme-tool-table.test.ts` cross-checks six surfaces.

### 58 REST endpoints under `/api/dsh-graph*`

* Defined in an `httpRoutes()` array of `{path, handler}` from `index.js:2825` to `:4164`
  (first `/api/dsh-graph/supervisor-session` at `:2828`, last `/api/dsh-graph/set-version-status` at `:4143`).
  Count of `path: "/api/dsh-graph鈥?` literals = 58.
* Workspace resolution is **per request**, never `process.cwd()`: `?workspace=`/`?root=` query or
  `body.workspace`/`body.root` (`index.js:2668-2685`), then `resolveCanonicalRoot` + idempotent `init`
  (`:2689-2697`); missing workspace = explicit `GraphError` (`:2681-2683`).
* Registered lazily because `webServer` may activate *after* `apply`: `ctx.get("webServer")` polled with
  chained `setTimeout` 鈥?10脳100 ms then 500 ms, ~16 s cap, silently skipped in headless compositions
  (`index.js:4320-4350`).

### Other host-side registrations (all feature-probed, all optional)

| Capability | How | Lines |
|---|---|---|
| Skills | `ctx.get('skills')` then `skills.register({name,description,source,content})` 鈥?`dsh-graph` and `dsh-graph-supervisor` | `:4184-4187` |
| System-prompt sections | polling `ctx.get("systemPrompt")` (20 s cap), registers 3 sections: guide hint (order 10), supervisor discipline (order 11, only for the claiming session), standing memory (order 92); render paths are pure-read with mtime+size fingerprint caches | `:4218-4318` |
| `subagent/end` event | `ctx.on("subagent/end", captureAttemptResults)` behind `typeof ctx.on === "function"` | `:4202-4207` |
| Settings | `ctx.inject(["settings"], 鈥?` capability probe: legacy `svc.register(ns, schema, {base})` 鈫?else `svc.describe()` form projection; else honest stderr degradation | `:1041-1085` |
| Self-test marker | `config.marker` writes `{plugin, tools:[鈥, validate}` JSON | `:4352-4366` |

### Minimal skeleton of "the smallest plugin DSH will load"

Verbatim from the repo's own verified recipe (`docs/plugin-loading-recipe.md:29-89`):

```jsonc
// package.json
{ "name": "dsh-hello-plugin", "version": "0.0.2", "private": true, "type": "module", "main": "index.js",
  "exports": { ".": "./index.js", "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```
```js
// index.js 鈥?named exports only, no @deepseek-ai/* runtime import
export const name = 'dsh-hello-plugin'
export const inject = ['tools']
export function apply(ctx, config) {
  ctx.effect(() => ctx.tools.register({
    name: 'hello_marker',
    description: 'Prove the third-party plugin is live.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'] },
              render: (_a, v) => [{ type: 'text', text: `marker=${v.marker}` }] },
    execute: async () => ({ marker: 'dsh-hello-plugin-alive' }),
  }))
}
```
```yaml
# cordis.patch.yml 鈥?bundle layer; bare package name, because specifiers resolve from the *profile* dir
- insert:
    - id: hello-plugin
      name: dsh-hello-plugin
      config: { greeting: from-bundle-layer }
```

Install: `dsh plugin --profile <p> add <path|pkg>` (auto-appends to `dsh.profile.bundles` when the package
declares `dsh.bundle.patch` 鈥?`docs/plugin-loading-recipe.md:96-111`). Verification must use a command that
**settles the tree** (`dsh --profile x "ping"`); `--help` exits before the Loader settles and hides failures
(`docs/plugin-loading-recipe.md:177-179`).

---

## 3. Client contract (browser side)

### How `lib/client/*.js` reaches the browser

Mechanism (recipe 搂1, `docs/client-plugin-loading-recipe.md:13-19`, cross-checked in
`鈥dsh-client-modules\lib\index.js:635-665` = `resolveMeta`/`locatePkgJson`):

1. `ClientModuleRegistry` (node half of `dsh-client-modules`) scans the host Loader's **enabled** rows
   (`entry.fiber !== void 0 && !entry.disabled`) 鈥?*the host half must be an active plugin first*.
2. per row: resolve `<name>/package.json`, read `dsh.client`; `platform !== 'web'` or no declaration 鈫?skip
   (result cached forever 鈬?changing the plugin set requires a restart).
3. resolve `exports["./client"]`, read the file, sha1-12 鈫?`rev`.
4. `tapIndex` injects into `index.html` `<head>`: the `__ModuleLoader__` facade, two parser-blocking
   `<script src>` (modules + runtime), and `<script>window.__DSH_BOOT__ = {rev, entries:[{id,url,rev,inject,immediately,external}]}</script>`.
5. `webServer.register({kind:'prefix', path:'/plugins', handler})` serves `/plugins/<id>/client.js[.map]`
   raw, `content-type: text/javascript`, `cache-control: no-cache`.

Package side of that contract (`dsh-graph-host/package.json:51-64`):

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web",
                     "inject": ["@deepseek-ai/dsh-client-runtime",
                                "@deepseek-ai/dsh-client-ui-settings",
                                "@deepseek-ai/dsh-client-ui-primitives",
                                "@deepseek-ai/dsh-client-ui-sidebar-right"] } }
```

`cordis.patch.yml:9-13` inserts the **bare package name** `dsh-graph` with `id: dsh-graph-host` and
`config.root: .dsh-graph` 鈥?one insert carries both halves (host tools + client bundle); `id` stays the
internal plugin id so user-layer patches can override config by id.

### Bundle format: classic script, not ESM

`dsh-graph-host/lib/client/_wrapper-top.js:1-18`:

```js
window.__ModuleLoader__.load({
  id: "dsh-graph",                       // must equal the package name
  factory(require) {
    const React = require("react");
    const ReactDOM = require("react-dom");
    const h = React.createElement;
    let MarkdownText = null;             // optional primitives, graceful degradation
    try { const p = require("@deepseek-ai/dsh-client-ui-primitives"); if (p && p.MarkdownText) MarkdownText = p.MarkdownText; } catch {}
    let dgT = (key) => key;              // global translator, set during plugin apply
```

Top-level `import`/`export` in the bundle is a hard SyntaxError (`docs/client-plugin-loading-recipe.md:94`).
`require` resolution order = platform seed words 鈫?materialized modules 鈫?registered factories 鈫?throw
(`:44-45`). The last concatenated file `_wrapper-bottom.js` is empty; `plugin.js:388-390` closes the factory
and the `load(...)` call.

### Entry point and mounting

`plugin.js:266-389` returns the client plugin:

```js
return {
  name: "dsh-graph",
  inject: ["slots", "sessions"],                 // hard injects kept minimal on purpose (:268-270)
  apply(ctx) {
    appCtx = ctx; sessionsRt = ctx.sessions ?? null;
    connectionRt = ctx.get?.("connection") ?? null;
    workspacesRt = ctx.get?.("workspaces") ?? null;
    鈥?    ctx.slots.inject("conversation.session.header.actions", () =>
      ctx.slots.register({ name: "conversation.session.header.actions", id: "dsh-graph-supervisor-badge", order: -9 },
                         (props) => h(SupervisorHeaderBadge, props)));          // :296-301
    ctx.slots.inject("conversation.view", () =>
      ctx.slots.register({ name: "conversation.view", id: "dsh-graph-kanban", order: 80,
                           label: () => dgT("board.title") },
                         (props) => h(KanbanView, props)));                     // :302-313
    try { registerGraphSettingsSection(ctx); } catch {}                          // :318
    ctx.inject?.(["remote"], (scope) => { appCtx = scope; 鈥?});                  // :322-326
    ctx.inject?.(["sidebarRightTabs"], (injected) => { 鈥?});                     // :327-385
  },
};
```

* **Primary mount = a tab inside the conversation view** (`conversation.view` slot, order 80), not a
  full page and not the sidebar. `KanbanView` does the work; `kanban.js:1-鈥 opens with `React.useState`
  declarations and runs to `:3440`.
* **Secondary mount = right-sidebar tab (g-330)**, registered two-stage exactly like the first-party
  `dsh-context` plugin: (1) `tabs.register({id:"dsh-graph", kind:"dsh-graph", title:()=>dgT(...), guide:[鈥})`,
  (2) seat `sidebar.right.pane.tab` with `key: SIDEBAR_TAB_ID`, (3) seat `sidebar.right.pane.tab.title`.
  It is deliberately **not** a hard inject 鈥?on a host without `sidebarRightTabs` the deferred callback
  simply never fires, so the in-conversation board, settings page and header badge keep working
  (`plugin.js:327-331`). Failure of any step disposes what succeeded and only loses the tab (`:372-379`).
* Data path: same-origin `fetch`, no CORS. All calls go through
  `graphUrl(path, extraParams, explicitWs)` which appends `?workspace=` derived from the *viewed* session
  (`plugin.js:129-137`); the workspace resolver walks session鈫抴orkspace membership, then cwd, then parent
  lineage and `currentAddress`, and **fails closed** (returns `null`) rather than reuse another session's
  cache (`plugin.js:7-127`). 30+ `fetch(graphUrl("/api/dsh-graph/鈥?))` call sites across
  `card-drawer.js`, `journal 鈥, `drag-prompts.js`, `goal-actions.js`, `goal-modal.js`, `criteria-modal.js`.
* i18n: own `dsh-graph` locale namespace (`i18n.js:1-鈥, ~2,073 lines of zh/en dictionaries) bound to the
  optional `locale` service; a `locale/change` listener re-creates `dgT` and broadcasts
  `dsh-graph:locale-changed` (`plugin.js:278-295`).

### Version-sensitive APIs the client relies on

| API / shape | Version story | Evidence |
|---|---|---|
| `sessions.open` / `openSubagent` 鈫?`uiWorkspace.openSession(address)` | navigation moved from `sessions` to `uiWorkspace` in 0.1.6; both probed, `uiWorkspace` never hard-injected | `plugin.js:156-179, 195-202`; `CHANGELOG.md:29` |
| `snap.current` / `snap.currentAddress` 鈫?`retainedBy.mainView > 0` | active-session detection is dual-path; **also** supports the `byId` record shape vs legacy `items` array | `plugin.js:99-118`; test `g321-dsh-016-compat.test.ts:7` |
| `subagentsByParent[pid].entries` 鈫?`projectionsBySession[sid].values.subagentCatalog`; catalog entries with/without `kind` | 0.1.7 replaced the subagent catalog; the plugin uses pure *shape probing*, never version comparison | `plugin.js:31-56`; `helpers.js:765-767, 832-836`; `CHANGELOG.md:28` |
| `session.getSnapshot().queue` 鈫?`projections.faceOf('inbox')` | destructuring `queue` throws on new hosts; hard rule "never destructure it" | `helpers.js:727-728`; `live-panel.js:9`; `goal-actions.js:34` |
| `sidebarRightTabs` / `sidebar.right.pane.tab` | feature-probed; absent 鈬?silent skip | `plugin.js:327-385` |
| `ctx.settingsScope` / host settings RPC | settings page reads catalog from `connection.api` when present, REST fallback otherwise | `settings.js:1-14` |

---

## 4. Data model & persistence

### Entities

| Entity | Location | Shape |
|---|---|---|
| Goal | `backlog/<slug>.md`, `goals/<slug>/goal.md`, `versions/<v>/goals/<slug>/goal.md` | Markdown with **JSON frontmatter** (`---\n{鈥\n---\n`) + body with managed `##` sections (`璐ㄩ噺鍒ゆ嵁`, directive, comments, results鈥? |
| Version lane | `versions/<slug>/version.md` + `versions/<slug>/goals/` | owned by `core/version-lane.ts`; released state replayed from events |
| Card (context card) | `<goal dir>/cards/<card-id>.md`, shared pool `shared-cards/` | lifecycle `empty 鈫?collecting 鈫?filled 鈫?reviewed`; refs from goals to shared cards are event-backed |
| Attachment | `.dsh-graph/attachments/鈥, referenced as `@att/<name>` | `core/ops.ts` `safePathTag`/`sanitizeAttachmentPath` reject absolute paths, `..` traversal, backslash, NUL |
| Attempt | `<goal dir>/attempts/<att-id>/attempt.md` + `delivery/`, `results*.md` | one execution try; handoffs and evidence summaries |
| Memory | `memory/memory.jsonl`, `memory/long-term/<slug>.md` | standing (cap 200) vs on-demand (cap 1000); limits mirrored in `lib/client/constants.js` and cross-checked by `memory-limits-g339.test.ts` |
| Event log | `events.jsonl` | append-only, **the single source of truth** |
| Index | `index.json` | derived cache, rebuildable, "do not hand-edit" |

### State machine (`core/machine.ts`)

8 states (`:10-19`): `draft 路 planning 路 collecting 路 ready 路 in_progress 路 review 路 delivered 路 blocked`.

```
draft        鈫?planning | blocked
planning     鈫?collecting | ready | blocked | in_progress
collecting   鈫?ready | planning | blocked | in_progress
ready        鈫?in_progress | collecting | blocked
in_progress  鈫?review | blocked | collecting
review       鈫?delivered | in_progress | blocked
delivered    鈫?review
blocked      鈫?(only blocked_from)
```
(`:24-33`.) Invariants enforced in `assertTransition` (`:50-91`):
`blocked` requires a non-empty `reason` and may only return to `meta.blocked_from`; entering `in_progress`
(unless `force`, used by GUI drag = human authorisation) requires a recorded `rules_snapshot`, a non-empty
criteria section, and a `criteria.confirmed` event.
Errors: `GraphError` (`:5`), `GraphConflictError` 鈫?REST 409 (`:8`).

### Criteria / context-card model

* Criteria live in the goal's `## 璐ㄩ噺鍒ゆ嵁` section; the canonical item definition is
  `criteriaItems()` 鈥?strip HTML comments, trim, drop template placeholders
  (`core/model.ts:186-205`). Verified items end with `鉁呭凡楠宍 (`:212-232`); `allCriteriaVerified` is
  **false when there are no criteria** (`:226-232`).
* Rewriting is surgical: `rebuildCriteriaSection()` preserves comments and blank lines, only replacing
  item lines and inserting `1. 鈥 numbering (`:241-277`).
* Section parsing is fence-aware: `## ` inside a closed ``` / ~~~ fence is not a heading; unclosed fences
  degrade safely (`computeClosedFenceMask`, `:92-126`; `findSectionBounds`, `:142-162`).

### On-disk layout (`schema/SCHEMA.md:14-40`)

```
.dsh-graph/
鈹溾攢鈹€ project.yaml          # project config + automation boundaries (+ supervisor.session)
鈹溾攢鈹€ rules.md              # global working rules, versioned frontmatter
鈹溾攢鈹€ backlog/<slug>.md
鈹溾攢鈹€ goals/<slug>/{goal.md, cards/, attempts/<att>/{attempt.md, delivery/}}
鈹溾攢鈹€ versions/<v>/{version.md, goals/<slug>/{goal.md, cards/, attempts/}}
鈹溾攢鈹€ shared-cards/<card-id>.md
鈹溾攢鈹€ attachments/鈥?鈹溾攢鈹€ memory/{memory.jsonl, long-term/<slug>.md}
鈹溾攢鈹€ skills-index.yaml
鈹溾攢鈹€ events.jsonl          # append-only;鍞竴鐪熺浉婧?鈹斺攢鈹€ index.json            # derived cache
```

* `init(root)` is idempotent and creates `backlog`, `goals`, `versions`, `memory/long-term`,
  `shared-cards`, `attachments`, plus `events.jsonl` (empty), `index.json` (`{}`) and `rules.md`;
  it appends `project.initialized` **only** on first creation (`core/ops.ts:334-352`).
* Event record: `{ts, actor, event, goal?, details}` (`core/events.ts:9-15`), one JSON per line,
  appended synchronously and followed by board-cache invalidation (`:47-63`). Rebuild = replay
  (`replayVersionLanes`, `:93-鈥); `graph_rebuild` / `graph_validate` expose it as tools.
* Board read path is cache-fronted: `computeGraphRevision` hashes root + generation + mtime/size of
  `events.jsonl`, `project.yaml`, `order.json`, `rules.md` 鈫?`ETag` + `If-None-Match` matching
  (`core/cache.ts:14-25`), with a watcher-generation guard that discards a payload if an event landed
  while it was being built (`:30-51`).
* Root resolution: `resolveRoot(config, workspaceRoot) = resolve(ws, config.root ?? ".dsh-graph")`, with a
  symlink-root rejection (`core/root.ts:80-93`). `resolveCanonicalRoot` adds Git detection: a **linked
  worktree** canonicalises to `<main-worktree>/.dsh-graph` (`:415-432`), while a **git-ignored scratch
  subdirectory** (repo `tmp/`, isolated instances) is treated as its own project root (`:258-262, 390-406`);
  results are cached 30 s with `.git` mtime validation (`:36, 208-213`). Modes:
  `absolute-config | main-tree | canonicalized | workspace-fallback` (`:337`).

---

## 5. Testing & build

| Aspect | Fact |
|---|---|
| Runner | `node --test core/tests/*.test.ts` (`package.json:8`) 鈥?Node 26 native TS type-stripping, **no** jest/vitest/mocha; assertions via `node:assert/strict` |
| Test count | 102 `*.test.ts` files (+ `_g374-harness.ts`, `_residue-guard.ts` helpers) = 104 files, 43,202 lines, **~1,452 top-level `test()` calls** |
| Naming | feature-named for old work (`core.test.ts`, `root.test.ts`, `schema.test.ts`, `card(s).test.ts`, `memory.test.ts`, 鈥? and ticket-named for newer work (`g272-鈥, `g321-dsh-016-compat.test.ts`, `g352-narrow-width.test.ts`, `g374-*` = 8 files) |
| Structure | flat directory, no nesting; fixtures in `core/tests/fixtures/`; each file self-contained (`mkdtempSync` temp roots, `init(root)`, act, assert) |
| What they exercise | core ops directly **and** the real host plugin through `apply(ctx, config)` with mocked `ctx` (`client.test.ts:43-70` mocks `webServer`, `sandboxPolicy`, `tools`); client modules are tested by loading source text and extracting functions with a brace-balancing extractor + `node:vm` (`g321-dsh-016-compat.test.ts:29-61`) |
| Dist dependency | several suites import `../../dist/index.js` (`client.test.ts:18`, `g321鈥?18`), so tests require a fresh build |
| `scripts/build.sh` | the atomic staging build described in 搂1 |
| `scripts/dsh-test-web.sh` (172 lines) | spins an **isolated** instance per DSH version: `DSH_HOME=./tmp/dsh-test/<stable-version>/home`, workspace `./tmp/dsh-test/<full-version>/workspace`, per-version pnpm store; installs `@deepseek-ai/dsh@<version>` into that root, runs `dsh plugin --profile web add link:<dist>`, asserts the effective config contains `dsh-base`, `dsh-web-app` and `dsh-graph`, then `exec`s `dsh web --no-open --port <p>` (default 3082, **refuses 3080**, refuses port passthrough of `--profile`/`--patch`/鈥? and pnpm-12 build-script allowlist retry logic (`:89-130, 164-172`) |
| Typecheck gate | `typecheck` script exists (`package.json:9`) but is **not** wired into `build`/`prepare`; `tsconfig.json:15-16` includes only `core/*.ts` and excludes `core/tests` 鈫?`tsc --noEmit` exit 0 鈮?repo-wide type safety. Guarded as an explicit, documented gap |

### "Machine guards" (docs-surface consistency tests)

These are tests whose subject is *documentation/manifest consistency* rather than runtime behaviour, and
they are deliberately built to fail on artificial breakage with negative-control fixtures:

| Guard | Pins |
|---|---|
| `g347-help-asset-guard.test.ts` | schema has exactly **49** `graph_*` tools; `prompts/help.{zh,en}.md` lists exactly that set, signatures cover every parameter with matching required/optional; `graph_help` returns the asset verbatim and the `dist` copy is byte-identical; assets read per call (no restart needed) |
| `g371-readme-tool-table.test.ts` | the tool-name set is identical across **six** surfaces (root README table, host README zh + en, help zh + en, `index.js` registrations, engine schema), each exactly 49; declared tool counts match; README/help memory-limit numbers must equal the real `MEMORY_LIMITS` |
| `g371-changelog-guard.test.ts` | `CHANGELOG.md` exists, version sections are well-formed, ordered newest-first, 鈮? bullets each, and free of process residue (`g-XXX` ids, gate numbers, test counts, tarball digests) |
| `g312 dist-freshness-g312.test.ts` | three families: byte-identical copies, generated `dist/package.json` field equality, and source-mtime-not-newer-than-artifact 鈥?i.e. "edited the source but did not rebuild" must go red |
| `g335-typecheck-gap-guard.test.ts` | the coverage gap must be documented in both languages with equal line counts; `package.json` exposes `typecheck` but must **not** chain it into `build`/`prepare`; no tests-specific loose tsconfig may exist; repo-wide scan coverage is re-asserted by `g346` |
| `g313-architecture-eval-guard.test.ts` | the dist supervisor guide and PM prompt rendering both carry the architecture-evaluation section and its anchors |
| `g348-atomic-build.test.ts` | atomic publish semantics, including the `BUILD_FORCE_TWO_RENAME=1` degraded path |
| `g363-scratch-isolation.test.ts` / `g289-workspace-cleanliness.test.ts` | isolated instances and git-ignored scratch dirs never write real board data |

---

## 6. Fork-ability assessment

### What is reusable as-is (pure, DSH-agnostic)

| Carry over | Why |
|---|---|
| `core/model.ts`, `core/machine.ts`, `core/events.ts`, `core/schema.ts`, `core/transaction.ts`, `core/platform.ts`, `core/cache-state.ts` | No DSH surface at all; small (80鈥?60 lines each); the state machine + JSON-frontmatter + append-only-event design is the genuinely reusable idea |
| `core/root.ts` | Workspace鈫抈.dsh-graph` resolution incl. Git worktree canonicalisation and the scratch boundary; ~440 lines, self-contained |
| `core/ops.ts` | 9,391 lines / ~150 ops. Reusable **as a library**, but it is the single biggest fork liability: it mixes the domain (goals/cards/versions/memory/review) with prompt assembly, attempt dispatch, results digest, i18n-free string formatting |
| `core/tests/*` | 43k lines of behaviour tests; ~most of them target core and would keep passing if `core/` is copied and the entrypoints preserved |
| `scripts/sync-core.sh` + the `tsc` settings in `tsconfig.json` | The "compile `.ts` out of `node_modules`' reach" trick is the one build step a fork genuinely needs |
| `docs/client-plugin-loading-recipe.md`, `docs/plugin-loading-recipe.md` | The most valuable artifact in the repo for a new project: verified, version-specific host/client loading recipes with negative controls |

### What must be rewritten / re-decided

| Rewrite | Why |
|---|---|
| `dsh-graph-host/index.js` (4,375 lines) | One file holds 49 tools + 58 routes + i18n binding + settings capability probing + system-prompt sections + worktree/prompt formatting. A clean project wants tool modules, a route table, and no prompt text in the transport layer |
| `dsh-graph-host/lib/client/*.js` (15,766 lines across 26 concatenated files) | Not modules: a hand-ordered concatenation sharing one factory scope, with `dgT`, `h`, `S`, `graphUrl` as ambient globals. Any real fork would adopt a bundler (`esbuild`/`tsdown`) and per-file ESM instead of `sed`-stripped concatenation |
| `build-client.sh` (PARTS order is a correctness contract) | The "must precede drag-prompts" ordering rules are an artefact of string concatenation, not of the design |
| The 43k-line test suite | It is tightly coupled to `ops.ts` function names and to `dist/index.js` import paths; only the core-behaviour subset survives a rewrite |

### What is version-locked to DSH `>=0.1.5-rc.2 <0.2.1-0`

| Locked thing | Evidence |
|---|---|
| `engines.dsh` range itself | `dsh-graph-host/package.json:30` |
| 3-generation settings API probing (legacy `register` 鈫?new `describe` form projection) | `index.js:1041-1085`; `CHANGELOG.md:27` |
| `uiWorkspace.openSession` vs `sessions.open`/`openSubagent`; `retainedBy.mainView` vs `snap.current`; `projectionsBySession` vs `subagentsByParent`; `faceOf('inbox')` vs `snap.queue` | `plugin.js:99-118, 156-202`; `helpers.js:727-836`; `CHANGELOG.md:28-29`; the 1,107-line `g321-dsh-016-compat.test.ts` and 502-line `g351-dsh-017-compat.test.ts` exist purely to pin this |
| `subagent/end` event name for output capture | `index.js:4202-4207` |
| Deferred client services `sidebarRightTabs`, `remote`, `connection`, `workspaces`, `locale` | `plugin.js:274-385` |
| CLI/install path assumptions (`dsh plugin add link:`, `DSH_HOME` isolation, pnpm 12 `allowBuilds`) | `scripts/dsh-test-web.sh:87-130` |

### Minimum viable slice to get a board rendering in DSH

Keep, in this order of value: (1) `docs/client-plugin-loading-recipe.md` as the spec;
(2) a **hand-written** `lib/client.js` classic-script bundle with one `conversation.view` registration
(dsh-project-kanban proved ~200 lines of `React.createElement` is enough);
(3) a host half that does nothing but `ctx.effect(() => ctx.webServer.register({kind:'exact', path:'/api/board', 鈥))`
plus a polled registration for compositions where `webServer` activates late;
(4) *optionally* `core/root.ts` + a tiny JSON store 鈥?the `.dsh-graph` layout and event log are only worth
copying once the board itself works.

---

## 7. Scale check

| Metric | Value |
|---|---|
| `core/*.ts` | 14 files, **13,368** lines (`ops.ts` 9,391; `version-lane.ts` 518; `worktree.ts` 453; `root.ts` 443; `schema.ts` 459; `model.ts` 278; `events.ts` 348; `review-policy.ts` ~361; `platform.ts` ~258; `main.ts` ~275; `transaction.ts` ~205; `machine.ts` 91; `cache.ts` 52; `cache-state.ts` ~36) |
| `dsh-graph-host/lib/client/*.js` | 26 files, **15,766** lines (`kanban.js` 3,440; `i18n.js` ~2,100; `goal-modal.js` ~1,570; `helpers.js` ~830; `constants.js` ~610; rest 60鈥?00 each) |
| `dsh-graph-host/index.js` | **4,375** lines (single file) |
| `dsh-graph-host/lib/server-i18n.js` | 131 lines |
| Tests | **102** `*.test.ts`(+2 helpers) = 104 files, **43,202** lines, **~1,452** `test()` cases |
| Docs | `docs/*.md` 27 files / 3,614 lines; `schema/SCHEMA.md` 329; root `README.md` 111; `dsh-graph-host/README.md` 266; `AGENTS.md` 120; `DESIGN.md` 341 |
| Prompts | 14 files (7 prompt kinds 脳 zh/en) |
| Published artifact | `index.js` 224,652 B; `core/ops.js` 442,771 B; `lib/client.js` 891,817 B |
| Tools / endpoints | 49 `graph_*` tools; 58 `/api/dsh-graph*` routes |
| Build scripts | `build.sh` 148, `build-client.sh` 86 (26-part `PARTS` order), `sync-core.sh` 45, `dsh-test-web.sh` 172, plus platform smoke tests `platform-smoke-test.mjs` 1,530 and `win-smoke-test.mjs` 797 |

**Verdict on scale:** the reusable domain core is ~2.5k lines; the DSH adapter + board is ~20k lines of
hand-rolled, string-concatenated, single-scope JS. A fresh build is cheaper than a fork **for the adapter and
UI**, while `core/` (domain) and the two loading recipes are worth lifting wholesale. Forking the whole tree
means inheriting a 43k-line test suite, an `mv --exchange`-dependent build, and a `sed`-based module system.

---

## 8. Desktop-host findings (the actual target)

The user's target is the **desktop** profile, not the `web` profile the repo's scripts assume.

| Fact | Evidence |
|---|---|
| Desktop profile runs **DSH 0.1.5-rc.3** (every `@deepseek-ai/*` package; cordis 4.0.2, schemastery 3.18.2) | `C:\Users\silence\.dsh\profiles\node_modules\@deepseek-ai\*\package.json` |
| Desktop profile already depends on `dsh-graph@^0.17.0`, and `node_modules\dsh-graph` holds the **built dist layout** (`index.js` 224,652 B, `core/*.js`, `lib/client.js` 891,817 B) | `C:\Users\silence\.dsh\profiles\desktop\package.json`; directory listing |
| **But** `dsh.profile.bundles` lists only `dsh-base`, `dsh-web-app`, and four experimental bundles 鈥?**`dsh-graph` is absent**. Since the bundle layer inserts the plugin row, and `dsh-client-modules` only scans *enabled Loader rows*, the plugin is **[inferred] installed but possibly not activated** on desktop. Verify with `dsh --profile desktop --dump-config` before assuming the board is live | `鈥desktop\package.json`; `docs/client-plugin-loading-recipe.md:15-17`; `dsh-client-modules\lib\index.js:635-665` |
| The desktop GUI has its own plugin manager (`鈥desktop\.plugin-manager\`), and its last two install operations **failed**: `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 鈥?the GitHub-tarball install of `miuzel/dsh-graph` needs a `prepare` build script, which pnpm blocks unless the package is in `allowBuilds` | `鈥desktop\.plugin-manager\logs\operation-b1Ilnn\pnpm.log`, `鈥operation-fmPzWO\pnpm.log` |
| `sidebarRightTabs` **does** exist on 0.1.5-rc.3: `ctx.sidebarRightTabs.register({id,kind,patterns?,priority?,canOpen?,title,guide?})` + seats `sidebar.right.pane.tab` / `.title` / `.guide` / `.menu.item`, provided by `dsh-client-ui-sidebar-right`, which `dsh-web-app@0.1.5-rc.3` depends on | `鈥dsh-client-ui-sidebar-right\README.md:2,77,84-87,138`; `lib\types\client\contract\slots.d.ts:12-71`; `dsh-web-app\package.json` dependencies |
| The settings service on 0.1.5-rc.3 still exposes the **legacy** `register(ns, schema, options)` *and* `describe()` 鈫?dsh-graph's old-capability branch wins on this host | `鈥dsh-settings\lib\types\index.d.ts:206-236` |
| Host services exist as expected: `dsh-tools`, `dsh-host-webserver`, `dsh-skill`, `dsh-system-prompt`, `dsh-subagent`, `dsh-sandbox-policy`, `dsh-workspace` | package descriptions under `鈥profiles\node_modules\@deepseek-ai\` |
| The desktop app itself is a 121 MB packed `app.asar`; `app.asar.unpacked\dsh\` contains only `node_modules`, so the Electron/GUI wiring could **not** be read. **Limitation of this reconnaissance** | `E:\Development\Tool\dsh\resources\` |

**Actionable consequence for Goal Dashboard:** to be installable on the desktop host, a new plugin must
(a) be reachable from `C:\Users\silence\.dsh\profiles\desktop` by Node resolution, (b) end up as an
**enabled loader row** (i.e. in `dsh.profile.bundles`, or inserted by the GUI plugin manager), and
(c) either ship prebuilt JS with **no `prepare`/build script** or document the pnpm `allowBuilds` entry 鈥?otherwise the desktop plugin manager's GitHub install fails exactly as the logs show.

---

## 9. Minimum viable plugin to render a board in DSH desktop 鈥?checklist

- [ ] **1. Repo skeleton** 鈥?`package.json`, `cordis.patch.yml`, `index.js` (host), `lib/client.js` (browser). No build step at all if you write plain JS.
- [ ] **2. `package.json`** 鈥?`"type":"module"`, `"main":"index.js"`; `exports` must contain `"."`, `"./client"`, `"./cordis.patch.yml"`, `"./package.json"`; `engines.dsh` matching the desktop host (`>=0.1.5-rc.2 <0.2.1-0` is safe for 0.1.5-rc.3); `"dsh":{"bundle":{"patch":"./cordis.patch.yml"},"client":{"platform":"web","inject":["@deepseek-ai/dsh-client-runtime"]}}`.
- [ ] **3. `cordis.patch.yml`** 鈥?one `- insert:` row with `id` (internal plugin id) + `name` (**bare npm package name**) + optional `config`.
- [ ] **4. Host half `index.js`** 鈥?`export const name`; `export const inject = ["tools"]`; `export function apply(ctx, config)`; **no `export default`**; **no runtime `@deepseek-ai/*` import**. Register 鈮? tool inside `ctx.effect(() => ctx.tools.register({name, parameters:{鈥?additionalProperties:false}, output:{schema,render}, execute}))`.
- [ ] **5. REST** 鈥?register `/api/<yours>` via **polled** `ctx.get("webServer")` (webServer may activate after `apply`), wrapped so the returned disposer is collected; read the workspace from `?workspace=` / `body.workspace`, never `process.cwd()`.
- [ ] **6. Client half `lib/client.js`** 鈥?classic script (no top-level `import`/`export`); `window.__ModuleLoader__.load({ id: "<package name>", factory(require){ const React = require("react"); 鈥?return { name, inject:["slots"], apply(ctx){ ctx.slots.inject("conversation.view", () => ctx.slots.register({name:"conversation.view", id:"<yours>", order:80, label:"Board"}, (p)=>React.createElement(Board, p))) } } })`.
- [ ] **7. Board data** 鈥?same-origin `fetch("/api/<yours>?workspace=" + ws)`; derive `ws` from the slot's `props.sessionId` through the `sessions`/`workspaces` runtime snapshots; **fail closed** (render "cannot determine workspace") rather than guessing.
- [ ] **8. Optional right-sidebar tab** 鈥?only behind `ctx.inject?.(["sidebarRightTabs"], 鈥?`: `tabs.register({id, kind, title, guide})` then seats `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` with the same key. Never hard-inject it.
- [ ] **9. Install on desktop** 鈥?make the package resolvable from `C:\Users\silence\.dsh\profiles\desktop`, and ensure it is an **enabled loader row**: add it to `dsh.profile.bundles` (e.g. `dsh plugin --profile desktop add <path|pkg>`) or use the GUI plugin manager. Confirm: `dsh --profile desktop --dump-config` shows your entry.
- [ ] **10. No build scripts if installing from GitHub** 鈥?pnpm blocks `prepare` for git-hosted packages (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`). Ship prebuilt JS, or document `allowBuilds` in the profile's `pnpm-workspace.yaml`.
- [ ] **11. Verify the 4 signals** 鈥?(a) `GET /` HTML contains a `__DSH_BOOT__` row with your package id; (b) `GET /plugins/<pkg>/client.js` 鈫?`200 text/javascript`; (c) `GET /api/<yours>` 鈫?JSON; (d) the board tab appears in the conversation view.
- [ ] **12. Respect the restart boundary** 鈥?client-bundle edits show up on page refresh (files served `no-cache`), but **host-half edits need a full DSH desktop restart** (`docs/client-plugin-loading-recipe.md:120-124`).
- [ ] **13. Failure blast radius** 鈥?a broken client bundle or a package declaring `dsh.client` without a `./client` file makes the *whole* web GUI fail to load (`assertEntriesActive` / `ClientPackageCompositionError`, `docs/client-plugin-loading-recipe.md:32,93`). Keep the first version tiny and feature-probe everything.

---

### Explicit limitations of this reconnaissance

* The Electron/desktop host internals are inside a packed `app.asar`; only `app.asar.unpacked\dsh\node_modules` was readable. Everything about the desktop GUI plugin manager comes from its **log files** and from the `dsh` CLI package under `鈥profiles\node_modules\@deepseek-ai\dsh\lib\plugin-*.js` (bundle reconciliation), not from the GUI source.
* Whether `dsh-graph` is currently armed on the desktop profile is **[inferred]** from the missing `dsh.profile.bundles` entry; it was not confirmed by running `dsh --profile desktop --dump-config` or by inspecting the live GUI.
* Line counts use newline counts over UTF-8 text; the read tool's "total lines" for individual files can differ by 1鈥? on trailing-newline handling.

