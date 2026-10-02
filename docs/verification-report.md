# Independent verification report — Goal-Dashboard (task-4)

**Verifier:** teammate `verifier` (independent of every author of the code under test).
**Role:** falsify the team's claims from the filesystem, commands and raw HTTP output. No product file was edited by this verification.
**Revision verified:** `git rev-parse HEAD` = `7dffb032dec2bd7a565cd383c82777cd29922099` (`release: v0.17.0`) **plus an uncommitted working tree** (see the pin table below). Everything in this report is pinned to the listed file hashes/mtimes; the tree was still being edited by `lead` / `skills-core` / `workflow-ui` while verification ran, so each item names the moment it was observed.

**Verdict legend:** `PASS` = reproduced and true · `FAIL` = reproduced and false · `UNVERIFIED` = could not be established, or was skipped because the environment refused the operation.

---

## 0. Headline

| # | What | Verdict |
|---|---|---|
| V1 | Root `package.json` is an installable plugin manifest | **FAIL** (1 of 12 sub-checks: `engines.dsh` excludes the desktop host version) |
| V2 | `dist/` artifacts (committed, fresh, parseable, banner, bundle id) | **FAIL** (1 of 10: `dist/` is not committed) |
| V3 | Plugin becomes an enabled loader row + served client bundle on a real host | **PASS** (on DSH 0.1.5-rc.3; not proven on 0.2.0-rc.2) |
| V4 | Host half registers the expected tools | **PASS** (54 tools, live host, self-reported) |
| V5 | Skills core: tests + catalog vs real `SKILL.md` files | **PASS** (18/18 tests; 37/37 entries byte-exact) |
| V6 | Adversarial | **PASS with one FAIL-observation** (a) PASS (b) PASS (c) FAIL — test suite pollutes the working tree; one sub-check UNVERIFIED |
| V7 | No regression vs baseline | **FAIL** — 105 failures vs 104 on pristine HEAD; **exactly 1 new failure**, precisely attributed |

Three things must not be softened:

1. **Pristine `v0.17.0` is not green on this machine**: 1514 tests, **104 pre-existing failures** (mostly Windows/EPERM/path issues). "The tests pass" is *not* a valid acceptance statement here. The bar used below is *baseline vs after*, per the Lead's instruction.
2. **`engines.dsh` does not accept `0.2.0-rc.2`** under standard semver prerelease semantics — the desktop host's exact version.
3. **`dsh plugin add` silently mis-parses any specifier containing a space** into multiple bogus registry packages. Verified by attribution: plain `pnpm add` with the same quoted specifier behaves correctly.

---

## 1. Revision pin (what was verified, and when)

Environment: Windows 10 (`PSVersion=5.1.19041.6456`), `node v22.21.1` (`E:\Development\Env\nodejs\node.exe`), `pnpm 11.27.1` (store `E:\.pnpm-store\v11`), Git bash `E:\Development\Tool\Git\bin\bash.exe`.
Hosts involved: CLI `@deepseek-ai/dsh 0.1.5-rc.3` (`E:\Development\Env\nodejs\node_modules\@deepseek-ai\dsh`); desktop app `@deepseek-ai/dsh-desktop 0.2.0-rc.2` with `@deepseek-ai/dsh 0.2.0-rc.2` inside `E:\Development\Tool\dsh\resources\app.asar`.

Final artifact hashes (SHA-256, `Get-FileHash`):

```
repo HEAD                 7dffb032dec2bd7a565cd383c82777cd29922099
package.json              fbd49cdbf2a74986…  bytes=1897   mtime 09:58:14
dist/index.js             D1C6E780AF65D54AEA1351E931A4812A2B6F3CA5FFAA40892BB22F66D4771946  bytes=234514  mtime 10:07:43
dist/lib/client.js        60D80FBD605B7E47506769D6A3323201F172A417484738ED730D9588DBB59C63  bytes=908176  mtime 10:16:33
dist/package.json         A95235D042C015E60BCB8FB9C21EC9FEA06E3FEE24801967FFF51B373CAEF3A9  bytes=1516
dsh-graph-host/index.js   D1C6E780AF65D54AEA1351E931A4812A2B6F3CA5FFAA40892BB22F66D4771946  (identical to dist/index.js)
core/skills.ts            mtime 10:01:33   bytes=24965
core/workflow.ts          mtime 10:02:13   bytes=15058
core/tests/skills-workflow.test.ts  mtime 10:03:02  bytes=18773
dsh-graph-host/lib/client/_wrapper-top.js  mtime 10:08:16 (rebrand landed here)
dsh-graph-host/lib/client/workflow-panel.js mtime 10:07:20  bytes=13190
```

Baseline was captured **before** the team's edits landed: the suite ran 09:57:23–09:58:11 while every changed file's mtime is 09:58:14 or later (`package.json` 09:58:14, `dsh-graph-host/package.json` 09:58:27, `.gitignore` 09:58:17, `pnpm-workspace.yaml` 09:58:33). The baseline is therefore pristine HEAD.

All verifier scripts are in `scripts/verify-*.mjs`; raw logs/artifacts in `tmp/verify/`.

---

## 2. V1 — root `package.json` is a valid installable plugin manifest

Command: `node scripts/verify-package.mjs`

| ID | Claim | Verdict | Raw evidence |
|---|---|---|---|
| V1.0 | root `package.json` parses | PASS | `name=goal-dashboard version=0.18.0 bytes=1897 sha256=fbd49cdbf2a74986` |
| V1.1 | name is `goal-dashboard` | PASS | `name="goal-dashboard"` |
| V1.2 | not `private` (installable) | PASS | `private=undefined` |
| V1.3 | version `0.18.0` | PASS | `version="0.18.0"` |
| V1.4 | `main` resolves to an existing file | PASS | `main=dist/index.js -> exists=true size=234514` |
| V1.5 | `exports["."]` resolves | PASS | `exports["."]=./dist/index.js exists=true size=234514` |
| V1.6 | `exports["./client"]` resolves | PASS | `./dist/lib/client.js exists=true size=908176` |
| V1.7 | `exports["./cordis.patch.yml"]` resolves | PASS | `./dist/cordis.patch.yml exists=true size=1102` |
| V1.8 | `exports["./package.json"]` resolves | PASS | `./package.json exists=true` |
| V1.9 | `dsh.bundle.patch` resolves | PASS | `./dist/cordis.patch.yml exists=true size=1102` |
| V1.10 | `dsh.client` = `platform:web` + non-empty `inject[]` | PASS | `{"platform":"web","inject":["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-client-ui-sidebar-right"]}` |
| V1.11 | **no** `scripts.prepare` | PASS | `scripts.prepare=undefined` (the only scripts are `build`, `test`, `typecheck`) |
| V1.12 | `engines.dsh` range includes `0.2.0-rc.2` | **FAIL** | see below |
| V1.13 | `dsh plugin add` installs this package without running builds | **FAIL for this checkout path**, PASS for a space-free path | see below |

### V1.12 — `engines.dsh` does not include the desktop host version (FAIL)

Raw evidence (`node scripts/verify-package.mjs`, semver 7.8.5 resolved from the DSH profile install):

```
engines.dsh=">=0.1.5-rc.2 <0.2.1-0"
satisfies(0.2.0-rc.2, default)=false
satisfies(0.2.0-rc.2, {includePrerelease:true})=true
```

Standalone cross-check:

```
$ node -e "const s=require('C:/Users/silence/.dsh/profiles/node_modules/semver');const r='>=0.1.5-rc.2 <0.2.1-0';for(const v of ['0.2.0-rc.2','0.2.0','0.1.5-rc.3'])console.log(v,s.satisfies(v,r),s.satisfies(v,r,{includePrerelease:true}))"
0.2.0-rc.2 => false | includePrerelease: true
0.2.0      => true  | includePrerelease: true
0.1.5-rc.3 => true  | includePrerelease: true
```

`0.2.0-rc.2` is numerically inside the interval, but node-semver's prerelease rule is that a prerelease version only satisfies a comparator set when a comparator with the *same* `major.minor.patch` carries a prerelease. Here the comparators are `>=0.1.5-rc.2` (tuple 0.1.5) and `<0.2.1-0` (tuple 0.2.1) — the tuple `0.2.0` appears in neither, so the version is excluded by default.

**Impact is deliberately not over-claimed:** whether any consumer (marketplace/precheck) evaluates `engines.dsh` with `includePrerelease` was **not established** by this verification, and the cordis loader does not read `engines` on the load path (observed: the row loads fine on 0.1.5-rc.3 without any engines check). The finding is exactly: *the declared range does not accept the desktop host's version string under default semver semantics.* If a precheck uses that semantics, the desktop card/install check will reject 0.2.0-rc.2.

### V1.13 — the `dsh plugin add` route is broken by a space in this checkout path (FAIL)

`resolve()`/`path.resolve` absolutisation inside `dsh plugin … add` produces a specifier containing the space in `…/Goal Dashboard/…`, and the specifier is then split on whitespace.

Raw evidence #1 — `dsh plugin --profile web add "link:$repo/tmp/verify/plugin"` (repo path contains `Goal Dashboard`):

```
[ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER] "Dashboard/tmp/verify/plugin" isn't supported by any available resolver.
```

Raw evidence #2 — a **relative** specifier is absolutised first, then split the same way; `dsh` exits 0 while having installed two wrong packages:

```
$ dsh plugin --profile web add "link:../../../plugin"
[WARN] Installing a dependency from a non-existent directory: E:/Development/Agents_Project/dsh_project/Goal
[WARN] Installing a dependency from a non-existent directory: …\profiles\web\Dashboard\plugin
dependencies:
+ Goal 0.0.0 <- ..\..\..\..\..\..\Goal
+ plugin 0.0.0 <- Dashboard\plugin
Done in 884ms using pnpm v11.27.1
EXIT=0
```

Resulting throwaway profile manifest (`tmp/verify/home/profiles/web/package.json`, since deleted):

```json
"dependencies": {
  "Dashboard": "^1.0.0",
  "Goal": "link:E:/Development/Agents_Project/dsh_project/Goal"
}
```

The first attempt to use the absolute spaced path pulled `Dashboard@1.0.0` **from the public registry** with 629 transitive packages (including `angular@1.8.3`, `request@2.87.0`, `core-js@1.2.6`) — i.e. the mis-parse silently installs an unrelated registry package.

Attribution (this is `dsh`'s bug, not pnpm's) — the same quoted specifier through plain pnpm works:

```
$ pnpm add "link:E:/Development/Agents_Project/dsh_project/Goal Dashboard/tmp/verify/plugin"
dependencies:
+ goal-dashboard 0.18.0 <- ..\plugin
Done in 815ms using pnpm v11.27.1
EXIT=0
→ package.json: "goal-dashboard": "link:E:/…/Goal Dashboard/tmp/verify/plugin"
```

Positive control — the real route on a space-free path (which is what `dsh plugin add github:owner/repo` effectively uses, since pnpm clones into a hash-named cache dir) works and auto-reconciles the bundle layer:

```
$ dsh plugin --profile web add "link:C:/Users/silence/AppData/Local/Temp/gd-verify-plugin"
dependencies:
+ goal-dashboard 0.18.0 <- C:\Users\silence\AppData\Local\Temp\gd-verify-plugin
EXIT=0
→ profile package.json:
   "dependencies": { "goal-dashboard": "link:C:/Users/silence/AppData/Local/Temp/gd-verify-plugin" }
   "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","goal-dashboard"] } }
```

Note what the positive control also proves: **no build script ran** and no `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` occurred — the package is installed as-is, which is the whole point of removing `prepare` and committing `dist/` (V2.1).

---

## 3. V2 — artifacts

Command: `node scripts/verify-package.mjs`, plus the repo's own guard `node --test core/tests/dist-freshness-g312.test.ts`.

| ID | Claim | Verdict | Raw evidence |
|---|---|---|---|
| V2.1 | `dist/` is committed | **FAIL** | `git ls-files dist` → `tracked_files=0`. `dist/` was un-ignored in `.gitignore` (09:58:17) but is still only untracked: `git status --porcelain` shows `?? dist/` |
| V2.2 | `node --check dist/index.js` | PASS | `exit=0 size=234514` |
| V2.3 | `node --check dist/lib/client.js` | PASS | `exit=0 size=908176` |
| V2.4 | generated-client banner present | PASS | `// ⚠️ GENERATED FILE — DO NOT EDIT DIRECTLY` + `scripts/build-client.sh` at the top |
| V2.5 | client bundle loader id == package name | **PASS** (was FAIL at 10:03) | `bundle_id=goal-dashboard package_name=goal-dashboard`; served bundle from the live host reports `__ModuleLoader__.load id = goal-dashboard` |
| V2.6 | `dist/package.json` name+version == root | PASS | `dist.name=goal-dashboard dist.version=0.18.0` |
| V2.7 | `dist/package.json` main | PASS | `main="index.js"` |
| V2.8 | `dist/cordis.patch.yml` insert name | PASS | `insert_name=goal-dashboard`, `id: dsh-graph-host` (internal id preserved on purpose) |
| V2.9 | byte-fresh `dist` vs source copies | PASS | `dist/index.js` == `dsh-graph-host/index.js` (`d1c6e780…`); `dist/cordis.patch.yml` == source (`512052f0…`); `dist/README.md` == source (`fb882783…`) |
| V2.10 | every `core/*.ts` has a `dist/core/*.js` at least as new | PASS | `core_ts=16 stale=[]` |
| V2.11 | repo's own byte-freshness guard | PASS | `node --test core/tests/dist-freshness-g312.test.ts` → `# tests 4 / # pass 4 / # fail 0` |

Timeline note on V2.5: at 10:03 the same check returned `bundle_id=dsh-graph package_name=goal-dashboard` (**FAIL**). `dsh-graph-host/lib/client/_wrapper-top.js:5` and `plugin.js:267` were updated at 10:08:16/10:08:08 and the client was rebuilt; the check flips to PASS. The verifier reported the FAIL at 09:59 before the fix landed and re-verified afterwards.

**V2.1 is the single gating item on the packaging half.** Until `dist/` is committed, `dsh plugin add github:Silencehuliang/Goal-Dashboard` would install a package whose `main`/`exports`/`dsh.bundle.patch` all point at files that do not exist in the repository, and `exports["./client"]` missing is a *hard* activation failure, not a degradation (see V6b).

---

## 4. V3 — activation on a real host (the crux)

Route used (**isolated**, never the user's live GUI): throwaway `DSH_HOME` under the repo's `./tmp/verify/home`, throwaway workspace `./tmp/verify/ws`, workspace-local plugin package, port **3082** (19387 and 3080 untouched), global CLI `dsh 0.1.5-rc.3`.

Commands (exact):

```
$env:DSH_HOME = "<repo>\tmp\verify\home"
dsh --profile web --dump-default-config                       # initialise throwaway profile
dsh plugin --profile web add "link:C:/…/Temp/gd-verify-plugin" # real install route, space-free path
dsh --profile web --dump-config                                # row present?
dsh web --no-open --port 3082                                  # managed background job
node scripts/verify-activation.mjs http://127.0.0.1:3082 <token> goal-dashboard tmp/verify <ws> g-001
```

### V3.1 Row composed — PASS

`dsh --profile web --dump-config` (`tmp/verify/dump-config.txt`, 544 lines):

```yaml
# == goal-dashboard
- id: dsh-graph-host
  name: goal-dashboard
  config:
    root: .dsh-graph
```

The row comes from the package's own `dsh.bundle.patch` (`dist/cordis.patch.yml`), so the manifest → bundle-layer → loader-row path works.

### V3.2 Row activated (host half really ran) — PASS

The isolated host printed, and a live marker written by the plugin itself confirms the tool registry:

```
[dsh-graph-host] g-118: guide hint section 已注册（所有会话注入引导提示词，root=<ws>\.dsh-graph）
[dsh-graph-host] g-131: supervisor discipline section 已注册（仅主管会话注入纪律提醒…）
[dsh-graph-host] apply: tools + /api/dsh-graph(+goal+write) registered (root=<ws>\.dsh-graph)
marker.json → { "plugin": "dsh-graph-host", "tools": [ …54 names… ], "validate": "PASS" }
```

The marker config was injected by a verifier-owned **user-layer** patch (`tmp/verify/marker-patch.yml` / profile `cordis.patch.yml`), i.e. it exercised the documented id-targeted override path as well. This is not a summary: the plugin wrote the list from `tools.filter(n => ctx.tools.get(n))` inside the real host process.

### V3.3 Boot graph row + served bundle — PASS (with an exact-URL caveat)

`GET /?token=…` → `303` → cookie → `GET /` → `200 text/html; charset=utf-8 bytes=28013`.
`window.__DSH_BOOT__` (`tmp/verify/boot-graph.json`, keys `["rev","entries","batches"]`) contains:

```json
{"id":"goal-dashboard",
 "url":"/plugins/??goal-dashboard/client.js&rev=95f38d272b38122d-48",
 "rev":"95f38d272b38122d-48",
 "inject":["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-client-ui-sidebar-right"]}
```

```
GET advertising row url -> 200 text/javascript; charset=utf-8 bytes=908264
  bundle loader id = goal-dashboard (expected goal-dashboard)
NEGATIVE CONTROL wrong rev     -> 404
NEGATIVE CONTROL unknown pkg   -> 404
```

**Caveat, stated loudly:** the criterion as written in the task — `GET /plugins/<pkg>/client.js` returns `200 text/javascript` — **does not hold on this host**. Both non-revisioned forms 404:

```
GET /plugins/goal-dashboard/client.js                       -> 404
GET /plugins/goal-dashboard/client.js?rev=95f38d272b38122d-48 -> 404
```

DSH 0.1.5-rc.3 (and 0.2.0-rc.2, same code shape) serve the **advertised combo URL** `/plugins/??<pkg>/client.js&rev=<rev>`; unknown/unrevisioned URLs are 404 by design. The substantive claim ("the client half is served to the browser, as JavaScript, under the package's own id") is verified — via the URL the host itself advertises. If some acceptance list literally greps for `/plugins/goal-dashboard/client.js`, that list is wrong for this host version.

Served bytes are the on-disk artifact, not something else:

```
$ node tmp/verify/compare-served.mjs
trailer="//# sourceMappingURL=/plugins/??goal-dashboard/client.js.map&rev=95f38d272b38122d-48"
served bytes=908264  served-minus-trailer bytes=908179  disk bytes=908176
first differing byte offset=-1
common prefix identical; extra tail served="\n;\n" disk=""
```

i.e. served == `dist/lib/client.js` (`60d80fbd…`) + the host's `\n;\n` separator + map trailer. The verification therefore applies to the exact current artifact.

### V3.4 REST surface through the live host — PASS

With a fixture goal + workflow run created by the verifier in the isolated workspace (`tmp/verify/seed-workspace.mjs`, core API used directly, not through any teammate's test):

```
GET /api/dsh-graph/board?workspace=<ws>                       -> 200  (contains standalone g-001)
GET /api/dsh-graph/workflow?workspace=<ws>&goal=g-001         -> 200 application/json
  keys=["goal","workflow","presets","catalog"] workflow=wf-018a2536 stage=grill 1/6 status=active
  state=active,pending,pending,pending,pending,pending  presets=5  catalog=37
GET /api/dsh-graph/workflows?workspace=<ws>                   -> 200 {"active":[{…wf-018a2536…}]}
NEGATIVE CONTROL /workflow without goal                       -> 400 {"error":"missing goal"}
NEGATIVE CONTROL unknown goal                                 -> 400 {"error":"目标不存在：g-001"}
```

`tmp/verify/http-workflow.json` holds the full frozen-contract payload (`{goal, workflow|null, presets, catalog}`).

### V3.5 Desktop host was not touched — PASS

```
C:\Users\silence\.dsh\profiles\desktop\package.json  mtime 2026-10-02T09:40:41+08:00  (before this session began, 09:56)
  dependencies: { "dsh-graph": "^0.17.0" }
  dsh.profile.bundles: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@deepseek-ai/dsh-experimental-…"]  ← no dsh-graph, no goal-dashboard
127.0.0.1:19387 (live GUI) = reachable;  127.0.0.1:3080 = not in use;  3082 freed after teardown
```

Independent confirmation of the problem statement, via the read-only host Inspect provider (`cordis_inspect_query`, provider `Config`): `listConfigs{name:"goal-dashboard"}` → `{entries:[],total:0}`; `listConfigs{name:"dsh-graph"}` → `{entries:[],total:0}`. The plugin is installed in the desktop profile but is **not** a live loader entry.

Teardown: background job killed; `tmp/verify/home`, `pnpm-store`, `cache`, `scratch`, the `%TEMP%` plugin copy and the plugin `dist` snapshot removed; port 3082 confirmed free (`False`).

---

## 5. V4 — tools registered by the host half

Two independent methods, same answer.

**(a) Live host, self-reported** (`marker.json`, written inside the 0.1.5-rc.3 process):

```
plugin=dsh-graph-host tools=54 validate=PASS
graph_create_goal,graph_set_criteria,…,graph_get_settings,graph_update_settings,
graph_workflow_list,graph_workflow_start,graph_workflow_advance,graph_workflow_status,graph_skills_catalog
```

**(b) Static extraction from the shipped artifact** (`node scripts/verify-tools.mjs`, bracket-balanced scan of the `const tools = [` region in `dist/index.js`):

```
file=dist/index.js bytes=234514 chars=203144
tools declared in array literal : 54 (unique 54)   duplicate names in literal: []
PRESENCE graph_workflow_list: PRESENT
PRESENCE graph_workflow_start: PRESENT
PRESENCE graph_workflow_advance: PRESENT
PRESENCE graph_workflow_status: PRESENT
PRESENCE graph_skills_catalog: PRESENT
REST routes matching path: "/api/dsh-graph*" : 60 (unique 60)
has bare `export default`: false
export const name = "dsh-graph-host"
export const inject = ["tools"]
dynamic import of dist/index.js: OK; keys=[… 23 named keys …]
```

Verdict **PASS**: 54 tools = the 49 upstream `graph_*` tools + the 5 new workflow/catalog tools; no duplicates; named exports only, no `export default`; `inject=["tools"]`. (`Config=undefined` on a bare dynamic import without `schemastery` resolvable — not exercised further; the live host's `apply()` ran normally.)

---

## 6. V5 — skills core

**Tests.** `node --test --test-reporter=tap core/tests/skills-workflow.test.ts` (re-run at 10:21 on the final revision):

```
# tests 18   # pass 18   # fail 0   # cancelled 0   # duration_ms 720
```

**Independent catalog spot-check** (`node scripts/verify-skills-catalog.mjs`) — the reference side is re-parsed by the verifier's own frontmatter reader, never by the product's parser:

```
reference SKILL.md files on disk : 37
MATTPOCOCK_SKILLS.length         : 37
entries=37 mismatched=0 missing-file=0 ref-not-in-catalog=0 duplicate-names=[]
WORKFLOW_PRESETS                 : 5 (engineering-feature, bugfix, spec-first, spike, architecture-deepening)
validateWorkflowPresets          : no problems reported
preset …badLanes=[] unknownSkills=[]
```

Every one of the 37 entries matches the real `E:\Development\Agents_Project\dsh_project\_ref\skills\skills\<category>\<name>\SKILL.md` on `name`, `description` (byte-exact) **and** invocation (`disable-model-invocation`). Three named spot-checks:

```
SPOT to-spec     :: skills\engineering\to-spec\SKILL.md
  raw     : description: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed."
  product : identical
SPOT code-review :: skills\engineering\code-review\SKILL.md   → description identical (incl. escaped \"review since X\")
SPOT grill-me    :: skills\productivity\grill-me\SKILL.md     → "A relentless interview to sharpen a plan or design."
```

**Premise correction (not a failure of the code, a failure of the task text):** task-2/task-4 said "39 skills". The clone contains exactly **37** `SKILL.md` files (engineering 20 / in-progress 6 / misc 4 / productivity 7; `skills/deprecated/` has only a README), and `.claude-plugin/plugin.json` lists a 27-skill subset. `core/skills.ts:14-17` documents the 37-vs-39 correction honestly. Verified verdict: catalog == disk, 37/37.

---

## 7. V6 — adversarial

Test file: `tmp/verify/adversarial.test.ts` (verifier-owned, 8 tests, all PASS: `# tests 8 / # pass 8 / # fail 0`).

**(a) Absent / malformed `workflow.json` — PASS.** No process crash; every malformed shape becomes a typed `GraphError`, never a raw `SyntaxError`/`TypeError`:

```
absent                    -> workflowStatus = null, listWorkflows = []
"{ this is not json "     -> GraphError: workflow.json 不是合法 JSON：…（Expected property name …）
"{}"                      -> GraphError: workflow.json 版本不支持：undefined（期望 1）
"null" / "[]"             -> GraphError: workflow.json 顶层必须是对象
version 99                -> GraphError: workflow.json 版本不支持：99（期望 1）
stageIndex=9 (len 1)      -> GraphError: workflow.json current 的 stageIndex 越界
status "weird"            -> GraphError: workflow.json current 的 status 非法：weird
bad history entry         -> GraphError: workflow.json history[0] 缺少非空 stages
workflowApiPayload(...)   -> throws GraphError (the REST adapter MUST catch it)
```

Transitions are also exactly-once and idempotent: `started=1, advanced=2, completed=1` for the 3-stage `bugfix` preset; re-advancing to the current stage rewrote nothing (`workflow.json` byte-identical) and emitted no event; skipping a stage and advancing a completed run both raise `GraphError`. Backlog (flat-file) goals are refused: `暂存目标（backlog）没有目录…`. Nothing new appears at the root (`root gained: []`).

> Semantic wart worth flagging (observed, deliberate per `core/workflow.ts:294`): **entering the last stage completes the run immediately** — the final stage never holds `state:"active"`, so a workflow can never be "in review and still active". Fine if intended; surprising if the UI strip expects a final active stage.

> UNVERIFIED sub-check: the hostile-`workflow.json`-symlink test was skipped — this host refuses symlink creation (`EPERM: operation not permitted, symlink …`). Whether `replaceFileAtomic` would write through a symlinked `workflow.json` was therefore not established.

**(b) A package declaring `dsh.client` with a missing client bundle — PASS (guard exists; blast radius confirmed).** Read out of the real 0.2.0-rc.2 desktop `app.asar` (extracted by `scripts/verify-asar.mjs` to `tmp/verify/asar/`):

```
dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js
  :713  const decl = parseDshClient(packageName, … dsh.client …)
  :719  if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
  :820  throw new MissingClientBundleError(pkgName, clientPath, error);   // ENOENT on the built bundle
  :128  const CLIENT_BUNDLE_BUILD_INSTRUCTION = "run `pnpm run build` before launch";
  :544  if (failures.length > 0) throw new ClientPackageCompositionError(failures);
```

The same shape exists in the 0.1.5-rc.3 closure used for the isolated run (`…dsh-client-modules/lib/index.js:479`, `ClientPackageCompositionError`, `MissingClientBundleError`). So: the guard **exists and fails loudly** ("`N client packages failed to compose: … client bundles not found; run pnpm run build before launch … package/path`"). Blast radius: the client-modules service fiber fails → the web client boot graph is not composed. It is *not* silent, and it is *not* degraded gracefully — which is exactly why V2.1 (committing `dist/`) matters.

**(c) Data-dir pollution — FAIL as an observation (upstream suite, not our diff).** The full upstream suite creates `./.dsh-graph` **in the repository root**:

```
before the baseline run (09:56): no .dsh-graph at repo root
after  the baseline run (09:57:32):
  .dsh-graph/events.jsonl → {"ts":"2026-10-02T09:57:32+08:00","actor":"core","event":"project.initialized",
                             "details":{"root":"E:\\…\\Goal Dashboard\\.dsh-graph"}}
  .dsh-graph/{backlog,goals,versions,memory,shared-cards,attachments}, index.json, rules.md
git check-ignore -v .dsh-graph → .gitignore:37:**/.dsh-graph/	.dsh-graph
```

So: **the test suite pollutes the repo working tree** (also leaving `tmp/g331-prompt-golden-root`, `tmp/g363-*`, `tmp/platform-gate`, and many `%TEMP%\dsh-graph-*` dirs). It is git-ignored (`.gitignore:37`) and upstream deliberately untracked the data dir (`git log -- .dsh-graph` → `8de4ab0 chore: untrack dsh-graph data repository`), so it cannot be committed — but the sentence "tests leave board skeleton in the repo root" is true and should not be presented as a clean run. The verifier's own runs did **not** write board data into the repo: all fixtures used `mkdtempSync` / `./tmp/verify/ws`, and the isolated host's `apply()` deferred `init` (g-149) leaving `tmp/verify/ws` empty of `.dsh-graph` until the verifier seeded it explicitly.

---

## 8. V7 — regression vs baseline (FAIL: 1 new failure)

`node --test --test-reporter=tap core/tests/*.test.ts`, TAP summary lines verbatim:

| Run | When | tests | pass | fail | cancelled | duration |
|---|---|---|---|---|---|---|
| baseline (pristine HEAD) | 09:57:23–09:58:11, before team edits | 1514 | 1408 | **104** | 2 | 48.4 s |
| after changes | 10:18:17–10:19:15 | **1532** | 1425 | **105** | 2 | 58.2 s |

(+18 tests = the new `skills-workflow.test.ts`; +17 passes.)

Failure-set diff by test *name*:

```
baseline failures = 102   after failures = 103
NEW failures (after, not in baseline): 1
  "g-174 标题栏源契约：version 链接、新建版本入口迁移、设置按钮位于 DEBUG 左侧"
FIXED (baseline, not in after): none
```

Attribution of the one new failure — `core/tests/client.test.ts:341` (test declaration), assertion at `core/tests/client.test.ts:348`, and it is **caused by our rebrand**:

```
The input did not match the regular expression
  /href: "https:\/\/github\.com\/miuzel\/dsh-graph",\s*\n\s*target: "_blank"/
Actual input contains:
  h("strong", …, "Goal-Dashboard"),
  h("a", { href: "https://github.com/Silencehuliang/Goal-Dashboard", target: "_blank", … }, "version: " + PLUGIN_VERSION),
```

The test hard-codes the upstream repository URL; the product now (correctly) points at the fork. It is a one-line test update, but as of this revision the suite is one test worse than baseline — reported as FAIL, not excused.

Baseline context for honesty: the 104 baseline failures are dominated by Windows/environment issues — `18× EPERM` (symlink/rename), a `C:`-segment lock-path bug (`Windows 非法字符`), `ERR_UNSUPPORTED_ESM_URL_SCHEME`, and the `无法确定目标 g-001 的当前位置` family. A Linux baseline was **not** established, so this report cannot say whether upstream is green on Linux.

---

## 9. Limitations of this verification

1. **Version gap — the most important limitation.** The desktop host is `@deepseek-ai/dsh 0.2.0-rc.2` (read by this verifier out of `app.asar`: root `package.json` = `@deepseek-ai/dsh-desktop 0.2.0-rc.2`, `dsh/node_modules/@deepseek-ai/dsh/package.json` = `0.2.0-rc.2`). Every **runtime** verification (loading, activation, tool registration, boot graph, HTTP serving, REST payloads) was executed on the **global CLI `0.1.5-rc.3`** with an isolated `DSH_HOME`, because the rule was to leave the user's live 0.2.0-rc.2 GUI untouched. Therefore: exact 0.2.0-rc.2 runtime behaviour is proven **only** for the APIs actually read from 0.2.0-rc.2 code (the client-modules guard), and is **not** proven for activation/serving. A 0.2.0-rc.2 run of the same `scripts/verify-activation.mjs` against a throwaway instance remains the outstanding verification.
2. **`engines.dsh` consumption is unproven.** This report establishes the semver semantics of the declared range; it does not establish whether any marketplace/precheck enforces it, nor whether it uses `includePrerelease`.
3. **No browser.** The client half was verified as *served, composed, correctly identified, revision-pinned* — not as *rendered*. No DOM/slot assertion was made; the workflow strip's actual render path is untested here.
4. **No LLM-driven path.** Tool invocation by a model, and hence the `graph_workflow_*` tool execution through a real agent turn, was not exercised (the isolated instance has no credentials). Tool **registration** is proven; tool **execution through the host** is not. The core functions themselves were exercised directly (V6).
5. **Windows/PS 5.1 environment.** The runtime is Windows PowerShell 5.1 (files written with `Out-File -Encoding utf8` carry a BOM; the verifier's throwaway YAML fixtures tolerated it). 104 of the baseline failures are Windows-specific; nothing here licenses a claim about Linux/macOS.
6. **Moving target.** `lead`, `skills-core` and `workflow-ui` were writing while this ran. Items are pinned to the hashes in §1; a later commit invalidates the artifact hashes (not necessarily the verdicts). Two verifier-observed flips are documented in place (V2.5 FAIL→PASS, V4 absent→present).
7. **One unexplained host action.** The verifier's space-free plugin snapshot in `%TEMP%\gd-verify-plugin` (and the earlier `verify-adv-*`/`verify-victim-*` fixtures) disappeared mid-session, before the verified files were re-read for the final diff. No repo script/test was found that deletes unrelated `%TEMP%` entries (`grep` for `readdirSync(tmpdir…)+rm` in `core/tests` found nothing; `%TEMP%` still holds 836 entries, mostly `dsh-graph-*`). Cause not established; no verdict depends on it because every piece of evidence was already copied into `tmp/verify/`.
8. **Not verified at all:** HMR / `patchReload`, worktree isolation, the supervisor/attempt features, `dsh web --host`, the desktop app's own loading path, and the `g-174` test fix.

---

## 10. What to fix, in order

1. **Commit `dist/`** (V2.1). Without it the git-install route installs a package whose client export does not exist — a hard `ClientPackageCompositionError`, not a degraded board.
2. **`engines.dsh`** (V1.12): `>=0.1.5-rc.2 <0.2.1-0` excludes `0.2.0-rc.2` under default semver. If the desktop host version must be accepted, widen to include prereleases (e.g. `>=0.1.5-rc.2 <0.2.1` plus an explicit prerelease-aware comparator, or document that consumers must pass `includePrerelease`).
3. **`core/tests/client.test.ts:348`** (V7): update the hard-coded `github.com/miuzel/dsh-graph` expectation to the fork URL — the only new regression.
4. **Note the `dsh plugin add` space bug** (V1.13) in install docs: any path containing a space silently installs unrelated registry packages. `dsh plugin add github:owner/repo` is unaffected (pnpm's clone dir is space-free), but any local-path instruction from a spaced directory is unsafe.
5. Optional: state plainly in the README that the test suite leaves `./.dsh-graph` and `tmp/*` residue (V6c), and that `v0.17.0` upstream is not green on Windows (104 baseline failures).

---

## 11. Reproduce

```powershell
$env:PSVersionTable.PSVersion  # 5.1 on this machine
node scripts/verify-package.mjs                       # V1 + V2 (all sub-verdicts, one line each)
node scripts/verify-tools.mjs                         # V4 static tool/REST inventory
node scripts/verify-skills-catalog.mjs                # V5 catalog vs _ref/skills
node scripts/verify-asar.mjs                          # desktop host versions + guard sources → tmp/verify/asar
node --test core/tests/skills-workflow.test.ts        # V5 tests
node --test core/tests/dist-freshness-g312.test.ts    # V2 byte-freshness guard
node --test tmp/verify/adversarial.test.ts            # V6a/V6c adversarial (verifier-owned)
node --test --test-reporter=tap core/tests/*.test.ts  # V7 (compare against tmp/verify/baseline-head.tap)
node scripts/verify-tap.mjs tmp/verify/baseline-head.tap --names
node tmp/verify/compare-served.mjs                    # served bundle == dist/lib/client.js
# V3 needs a live isolated instance; see §4 for the exact command sequence.
```

Evidence files: `tmp/verify/` — `baseline-head.tap`, `after-change.tap`, `skills-workflow.tap`, `adversarial.tap`, `dump-config.txt`, `boot-graph.json`, `http-root.html`, `http-client-goal-dashboard.js`, `http-workflow.json`, `marker.json`, `activation-run.log`, `web2.log`, `plugin-add*.log`, `asar/`, `pinned-head.txt`.
