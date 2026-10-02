# Independent verification report — Goal-Dashboard (task-4)

**Verifier:** teammate `verifier` (independent of every author of the code under test).
**Role:** falsify the team's claims from the filesystem, commands and raw HTTP output. No product file was edited by this verification.
**Revision verified:** `git rev-parse HEAD` = `7dffb032dec2bd7a565cd383c82777cd29922099` (`release: v0.17.0`) **plus an uncommitted working tree** (see the pin table below). Everything in this report is pinned to the listed file hashes/mtimes; the tree was still being edited by `lead` / `skills-core` / `workflow-ui` while verification ran, so each item names the moment it was observed.

**Verdict legend:** `PASS` = reproduced and true · `FAIL` = reproduced and false · `UNVERIFIED` = could not be established, or was skipped because the environment refused the operation.

---

## 0. Headline

| # | What | First pass (working tree @ `7dffb03` + edits) | Final pass (**commit `7e8e016`**) |
|---|---|---|---|
| V1 | Root `package.json` is an installable plugin manifest | FAIL (1/12 — `engines.dsh` excluded `0.2.0-rc.2`) | **PASS (12/12)** |
| V2 | `dist/` artifacts (committed, fresh, parseable, banner, bundle id) | FAIL (1/10 — `dist/` untracked) | **PASS (10/10)** |
| V3 | Enabled loader row + served client bundle on a real host | PASS on DSH 0.1.5-rc.3 only | **PASS on 0.1.5-rc.3 AND on 0.2.0-rc.2** |
| V4 | Host half registers the expected tools | PASS (54 tools, live host) | **PASS (54 tools on both hosts)** |
| V5 | Skills core: tests + catalog vs real `SKILL.md` files | PASS (18/18; 37/37 byte-exact) | **PASS (unchanged)** |
| V6 | Adversarial | PASS + 1 FAIL-observation (test-suite pollution) + 1 UNVERIFIED (symlink `EPERM`) | **unchanged** (both items are environment-bound) |
| V7 | No regression vs baseline | FAIL — 105 vs 104, 1 new failure attributed | **PASS — 0 new, 1 fixed** |

Four things must not be softened:

1. **Pristine `v0.17.0` is not green on this machine**: 1514 tests, **104 pre-existing failures** (mostly Windows/EPERM/path issues). "The tests pass" is *not* a valid acceptance statement here. The bar used below is *baseline vs after*, per the Lead's instruction — and at `7e8e016` the suite is **103 failures (108 including nested subtests) vs 104/108 baseline: one test better, none worse**.
2. **`engines.dsh` did not accept `0.2.0-rc.2`** under standard semver prerelease semantics — the desktop host's exact version. This was a real bug in the first pass; it is **fixed at `7e8e016`** and the new range is re-verified with a full truth table in §12.2.
3. **`dsh plugin add` silently mis-parses any specifier containing a space** into multiple bogus registry packages (including one fetched from the public registry). Verified by attribution: plain `pnpm add` with the same quoted specifier behaves correctly. **Still present (it is a `dsh` defect, not ours)**; install docs must keep warning about space-containing paths.
4. **Roughly eight of the remaining Windows failures are line-ending artefacts of the guards themselves, not product defects** — proven by re-evaluating the exact patterns against the same sources with EOL normalised (§12.3). A stale-but-green guard would be worse than a red one; these are red-for-the-wrong-reason guards, and the Lead already fixed one of them (g-352 att-005) in `7e8e016`.

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

> **First pass, kept as history.** Superseded by §12.3: at commit `7e8e016` the same comparison yields **0 new failures and 1 fixed**. The one new failure found here (`client.test.ts:348`, g-174) was fixed by the `surfaces` teammate before the push.

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

1. **Version gap — CLOSED at `7e8e016`.** The desktop host is `@deepseek-ai/dsh 0.2.0-rc.2` (read by this verifier out of `app.asar`: root `package.json` = `@deepseek-ai/dsh-desktop 0.2.0-rc.2`, `dsh/node_modules/@deepseek-ai/dsh/package.json` = `0.2.0-rc.2`). The first pass could only runtime-verify on the global CLI `0.1.5-rc.3`. The final pass also ran a **real isolated 0.2.0-rc.2 host** (`pnpm add @deepseek-ai/dsh@0.2.0-rc.2`, throwaway `DSH_HOME` under `./tmp/verify-rc2`, port 3083) and re-ran V3/V4 there end-to-end (§12.4). Both host versions report the same result; what remains unproven is only the Electron **shell** around it (the desktop app's own window boot), not the DSH runtime behaviour.
2. **`engines.dsh` consumption is unproven.** This report establishes the semver semantics of the declared range; it does not establish whether any marketplace/precheck enforces it, nor whether it uses `includePrerelease`.
3. **No browser.** The client half was verified as *served, composed, correctly identified, revision-pinned* — not as *rendered*. No DOM/slot assertion was made; the workflow strip's actual render path is untested here.
4. **No LLM-driven path.** Tool invocation by a model, and hence the `graph_workflow_*` tool execution through a real agent turn, was not exercised (the isolated instance has no credentials). Tool **registration** is proven; tool **execution through the host** is not. The core functions themselves were exercised directly (V6).
5. **Windows/PS 5.1 environment.** The runtime is Windows PowerShell 5.1 (files written with `Out-File -Encoding utf8` carry a BOM; the verifier's throwaway YAML fixtures tolerated it). 104 of the baseline failures are Windows-specific; nothing here licenses a claim about Linux/macOS.
6. **Moving target.** `lead`, `skills-core` and `workflow-ui` were writing while this ran. Items are pinned to the hashes in §1; a later commit invalidates the artifact hashes (not necessarily the verdicts). Two verifier-observed flips are documented in place (V2.5 FAIL→PASS, V4 absent→present).
7. **One unexplained host action.** The verifier's space-free plugin snapshot in `%TEMP%\gd-verify-plugin` (and the earlier `verify-adv-*`/`verify-victim-*` fixtures) disappeared mid-session, before the verified files were re-read for the final diff. No repo script/test was found that deletes unrelated `%TEMP%` entries (`grep` for `readdirSync(tmpdir…)+rm` in `core/tests` found nothing; `%TEMP%` still holds 836 entries, mostly `dsh-graph-*`). Cause not established; no verdict depends on it because every piece of evidence was already copied into `tmp/verify/`.
8. **Not verified at all:** HMR / `patchReload`, worktree isolation, the supervisor/attempt features, `dsh web --host`, the desktop app's own loading path, and the `g-174` test fix.

---

## 10. What to fix, in order — **status at `7e8e016`**

1. ~~**Commit `dist/`** (V2.1)~~ — **DONE**: `git ls-files dist` = 39 at `7e8e016`.
2. ~~**`engines.dsh`** (V1.12)~~ — **DONE**: now `>=0.1.5-rc.2 <0.2.1-0 || >=0.2.0-rc.1 <0.2.1-0` in the root manifest, the host manifest, `dist/package.json` and the READMEs; re-verified with a truth table (§12.2). *Residual nuance:* `0.2.0-rc.0` is still excluded (it is below `>=0.2.0-rc.1`); that is intended-looking, but worth a one-line note in the README rationale if the range is meant to mean "all 0.2.0 prereleases".
3. ~~**`core/tests/client.test.ts:348`** (V7)~~ — **DONE**: the g-174 regression is gone; the full suite shows 0 new failures (§12.3).
4. **Still open — `dsh plugin add` space bug** (V1.13): any path containing a space silently installs unrelated registry packages. `dsh plugin add github:owner/repo` is unaffected (pnpm's clone dir is space-free), but any local-path instruction issued from a spaced directory is unsafe. Keep the warning in the install docs.
5. **Still open (new) — Windows CRLF makes several guards red-for-the-wrong-reason** (§12.3): ~8 guards compare CRLF sources against the LF-built `dist/lib/client.js` or use `\n` multi-line patterns, so they can never pass on a built Windows tree even when the product is correct. The same class of bug the Lead fixed for g-352 att-005 also affects `client.test.ts:1911` (g-181), `client.test.ts:3659` (g-244) and five `g352-narrow-width` 判据 guards. A shared EOL-normalising read helper in the test suite would turn ~8 permanently-red guards into real signal.
6. **Still open (new) — fresh-clone EOL of `dist/`** (§12.1): with `core.autocrlf=true`, a fresh `git clone` materialises `dist/lib/client.js` as CRLF (924 151 bytes) although the committed blob is LF (908 176 bytes). JavaScript tolerates that, and it actually *helps* the CRLF-sensitive guards, but it means "byte-identical to the committed artifact" is only true inside one checkout form.
7. Optional: state plainly in the README that the test suite leaves `./.dsh-graph` and `tmp/*` residue (V6c), and that `v0.17.0` upstream is not green on Windows (104 baseline failures).

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
node scripts/verify-classify.mjs tmp/verify/baseline-head.tap tmp/verify/final-7e8e016.tap   # V7 delta
node scripts/verify-crlf.mjs tmp/verify/final-7e8e016.tap   # are regex failures CRLF artefacts?
node tmp/verify/eol-cases.mjs                        # the two non-regex CRLF cases
node tmp/verify/verify-g352-refreeze.mjs             # g-352 fixture re-freeze: not laundered
# V3 needs a live isolated instance; see §4 for the exact command sequence.
# 0.2.0-rc.2 route (§12.4): pnpm add @deepseek-ai/dsh@0.2.0-rc.2 into ./tmp/verify-rc2/runtime,
#   DSH_HOME=./tmp/verify-rc2/home, `dsh plugin --profile web add link:<space-free copy>`,
#   `dsh web --no-open --port 3083`, then scripts/verify-activation.mjs against it.
```

Evidence files: `tmp/verify/` — `baseline-head.tap`, `after-change.tap`, `final-7e8e016.tap`, `skills-workflow.tap`, `adversarial.tap`, `dump-config.txt`, `boot-graph.json`, `http-root.html`, `http-client-goal-dashboard.js`, `http-workflow.json`, `marker.json`, `activation-run.log`, `web2.log`, `plugin-add*.log`, `asar/`, `pinned-head.txt`; and `tmp/verify-rc2/` for the 0.2.0-rc.2 instance (`activation-rc2c.log`, `boot-graph.json`, `http-client-goal-dashboard.js`, `http-combo-goal-dashboard.js`, `marker.json`, `web-rc2*.log`, `runtime-install*.log`).

---

## 12. Final verification pass — commit `7e8e016`

Everything below was produced **after** the Lead pushed, against the pushed commit, with a clean working tree (`git status --porcelain` → 0 lines). This section supersedes the first-pass verdicts in §2/§3/§8 for V1/V2/V7 and closes the 0.2.0-rc.2 runtime gap from §9.1.

### 12.1 Revision pin (final)

```
git rev-parse HEAD   = 7e8e0163b315329cfa9525d06936bfa66ec4e09b   (feat: Goal-Dashboard — DSH desktop-compatible fork…)
git status --porcelain = <empty>
git ls-files dist | wc -l = 39
package.json sha256            ac472614c27997fb   bytes=1947
dist/index.js sha256           d1c6e780af65d54a…  working tree 234514 B (CRLF) / blob 230020 B (LF)
dist/lib/client.js sha256      60d80fbd605b7e47…  working tree 908176 B (LF)  / blob 908176 B (LF)  ← byte-identical
dist/package.json sha256       d27ee2b8dc969116…
```

**What was actually verified about "committed `dist/`" (the `core.autocrlf=true` question), measured, not assumed:**

| path | blob bytes / CRLF | `git cat-file --filters` (= fresh checkout) | working tree now |
|---|---|---|---|
| `dist/lib/client.js` | 908176 / **0** | 924151 / 15975 | 908176 / **0** |
| `dist/index.js` | 230020 / 0 | 234514 / 4494 | 234514 / 4494 |
| `core/tests/fixtures/g352-conv-signature.txt` | 10167 / 0 | 10228 / 61 | 10167 / 0 |
| `package.json` | 1947 / 0 | 2026 / 79 | 1947 / 0 |
| `dsh-graph-host/lib/client/helpers.js` | 42998 / 0 | 43868 / 870 | 43868 / 870 |

So:
* `git ls-files dist` = 39 and the **working-tree `dist/lib/client.js` is byte-identical to the committed blob** (same size, same SHA-256) — the artifact I served and hashed in V3 *is* the committed artifact. That is the strongest form of the V2.1 claim.
* `dist/index.js` in the working tree is the CRLF checkout form; it is identical to `dsh-graph-host/index.js` in the same form (V2.9) and `node --check` passes.
* A **fresh clone** with `core.autocrlf=true` (the setting on this machine) materialises the dist text files as CRLF — including `dist/lib/client.js` at 924 151 bytes. This is not a defect (CRLF JavaScript is valid, and the loader serves bytes), but it means "byte-fresh" must always be stated together with the checkout form. It also means the CRLF-sensitive guards of §12.3 would behave differently on a fresh clone (both sides CRLF) than in a locally built tree (sources CRLF / bundle LF).

### 12.2 V1 re-issued — PASS (12/12), with the engines truth table

`node scripts/verify-package.mjs` at `7e8e016`:

```
V1.12 PASS engines.dsh range includes 0.2.0-rc.2
     engines.dsh=">=0.1.5-rc.2 <0.2.1-0 || >=0.2.0-rc.1 <0.2.1-0"
     satisfies(0.2.0-rc.2)=true  satisfies(includePrerelease)=true   via semver 7.8.5
```

Independently re-evaluated truth table (`node -e`, semver 7.8.5, default semantics):

| version | satisfies | | version | satisfies |
|---|---|---|---|---|
| 0.1.4 | false | | 0.2.0-rc.0 | **false** |
| 0.1.5-rc.1 | false | | 0.2.0-rc.1 | **true** |
| 0.1.5-rc.2 | true | | **0.2.0-rc.2 (desktop host)** | **true** |
| 0.1.5-rc.3 (CLI used here) | true | | 0.2.0 | true |
| 0.1.6 / 0.1.7 / 0.1.99 | true | | 0.2.1-rc.1 | false |
| | | | 0.2.1 / 0.3.0 | false |

Old range for contrast: `0.2.0-rc.1 → false`, `0.2.0-rc.2 → false`, `0.2.0 → true`.

The range string is present in all three manifests (`package.json`, `dsh-graph-host/package.json`, `dist/package.json`) — checked explicitly because `dist/package.json` is generated and was briefly stale during the change window (it was rebuilt at 10:28:45, 21 s after this verifier first observed the drift; the final pass shows all three consistent). One nuance, not a defect unless unintended: **`0.2.0-rc.0` is excluded** (it is below `>=0.2.0-rc.1`).

### 12.3 V2 re-issued (10/10) and V7 — **0 new failures, 1 fixed**

`node scripts/verify-package.mjs` → V2.1 PASS (`tracked_files=39`), V2.2–V2.10 PASS (banner present, `node --check` both artifacts exit 0, `bundle_id=goal-dashboard`, manifest/name/version consistent, byte-freshness vs sources PASS, `core_ts=16 stale=[]`).

`node --test --test-reporter=tap core/tests/*.test.ts` on the clean commit, diffed against the pristine-HEAD baseline:

| run | tests | pass | fail | cancelled | top-level `not ok` | incl. nested |
|---|---|---|---|---|---|---|
| baseline (pristine `7dffb03`) | 1514 | 1408 | 104 | 2 | 102 | 108 |
| **final (`7e8e016`)** | 1532 | **1427** | **103** | 2 | 101 | **107** |

```
NEW failures (0):
no-longer-failing (1):
  [g352-narrow-width.test.ts] g-352 att-005：会话内看板页签签名 == 冻结 fixture，且 fixture 的来源 commit/内容 hash 头自校验
```

The `+18` tests are the new `skills-workflow.test.ts` (re-run separately at this commit: **18/18 PASS**). `scripts/verify-tools.mjs` at this commit: 54 tools, all five `graph_workflow_*`/`graph_skills_catalog` PRESENT, 60 REST routes, no `export default`.

#### (a) Classification of the 15 failures the Lead listed — **all pre-existing, none caused by our diff**

Method: each named test was located in **both** TAPs by file+line+name, and the error strings compared verbatim. Every entry below appears identically in the pristine-HEAD baseline; the only delta between the runs is the one *fixed* test above.

| Lead's item | test (file:line) | mechanism (verified) | pre-existing? |
|---|---|---|---|
| client #80 | `client.test.ts:1911` g-181 | `helpers.indexOf("\n    }\n")` vs a **CRLF** source: raw → `hookEnd=6` (fails); EOL-normalised → `hookEnd=12232` (passes) | YES — identical |
| client #116 | `client.test.ts:2767/2776` g-223 (2 nested) | `test did not finish before its parent and was cancelled` — these *are* the 2 `cancelled` tests in both runs | YES — identical |
| client #140 | `client.test.ts:3659` g-244 | `bundle.includes(pluginSlice)`: slice from CRLF `plugin.js`, bundle built **LF** → raw `false`, normalised `true` | YES — identical |
| (extra) | `client.test.ts:2969` g-189 | `ENOENT … 'E:\\E:\\…\\Goal%20Dashboard\\dist\\index.js'` — the test prefixes a drive letter to a URL-encoded path | YES — identical |
| g347 #213 | `g347-help-asset-guard.test.ts:510` | `EPERM … symlink node_modules → tmp` (no Developer-Mode symlink privilege) | YES — identical |
| g352 #219 | `g352-narrow-width.test.ts:211` | `\n` multi-line regex vs CRLF: matches **only** after EOL normalisation (`kanban.js`) | YES — identical |
| g352 #221 | `g352-narrow-width.test.ts:248` | same class (`kanban.js`) | YES — identical |
| g352 #223 | `g352-narrow-width.test.ts:320` | same class (`goal-modal.js`) | YES — identical |
| g352 #224 | `g352-narrow-width.test.ts:334` | `EPERM … rename …versions\v-a\goals\g-001 → …` | YES — identical |
| g352 #228 | `g352-narrow-width.test.ts:468` | same class (`card.js`) | YES — identical |
| g352 #229 | `g352-narrow-width.test.ts:488` | same class (`kanban.js`) | YES — identical |
| g352 #232 | `g352-narrow-width.test.ts:575` | `build-client.sh 执行失败…spawnSync bash ENOENT` (no `bash` on `PATH` for `spawnSync`) | YES — identical |
| plugin #295 | `plugin.test.ts:17` | `EPERM … rename …versions\v-t\goals\g-001 → …goals\g-001` | YES — identical |
| root #313 | `root.test.ts:50` | expects `/base/.dsh-graph`, gets `E:\base\.dsh-graph` (POSIX literal vs Windows `resolve`) | YES — identical |
| root #324 | `root.test.ts:218` | expects `/custom/graph`, gets `E:\custom\graph` — same class | YES — identical |
| g-113 #298 | `plugin.test.ts:163` | hard-coded `".dsh-graph/versions/v-t/goals/"` (forward slashes); line 162, computed via `path.relative`, **passes** — so the prompt uses `\` on Windows | YES — identical |

Decisive evidence for the CRLF class — `scripts/verify-crlf.mjs` re-evaluates the *exact regex literal printed in the TAP* against the real sources twice:

```
TAP=tmp/verify/final-7e8e016.tap
failure blocks containing a printed regex: 5
CRLF-ARTEFACT (matches only after EOL normalisation)  × 5
  … minWidth: 0,\n\s*overflow: "hidden",\n\s*cursor: "default",      raw=false lf=true  (kanban.js)
  … const standaloneLaneDefault = !!(narrowSingleTier && …           raw=false lf=true  (kanban.js)
  … !isArchived\n\s*\? h\(VersionSelectorButton, \{                   raw=false lf=true  (goal-modal.js)
  … open \? h\("div", \{\n\s*style: S\.inlineMenu,                    raw=false lf=true  (card.js)
  … active\.length === 0\n\s*\? h\("div", …                          raw=false lf=true  (kanban.js)
--- summary: crlf-only=5 not-explained=0 skipped=0 ---
```

And the two non-regex cases (`tmp/verify/eol-cases.mjs`):

```
helpers.js         870 CRLF / 0 LF      dist/lib/client.js  0 CRLF / 15975 LF
g-181 raw         hookStart=12121 hookEnd=6      assertion=false
g-181 normalised  hookStart=11882 hookEnd=12232  assertion=true
g-244 resolverSrc length=6182 contains CRLF=true
g-244 bundle.includes(rawSlice)             = false   <- what the test asserts
g-244 norm(bundle).includes(norm(rawSlice)) = true
g-113 plugin.test.ts:163 hard-codes "/" while path.sep = "\\" (win32); line 162 passes
```

**Verdict for (a):** every one of the 15 is a pre-existing environment artefact — Windows CRLF mismatches (8), `EPERM` symlink/rename without Developer Mode (3), `spawnSync bash` not found (1), POSIX absolute-path literals (2), POSIX separator vs `path.sep` (1), and 2 parent-cancelled async subtests. **Nothing is caused by the Goal-Dashboard diff**, and the diff additionally removed one failure.

#### (b) Independent check of the g-352 att-005 re-freeze — **PASS, not laundered**

`node tmp/verify/verify-g352-refreeze.mjs` (re-derives the frozen body hash and the source fingerprint from scratch, using the guard's own rules):

```
headers: source-commit  6d5500ac… -> 7dffb032…   changed=true
         source-sha256  2bf46cbd… -> 4497b38c…   changed=true
         content-sha256 0e6b7094… -> 0e6b7094…   changed=FALSE
line-level diff HEAD~1 -> HEAD: 62 -> 62 lines, differing lines = 2
  L2 - # source-commit: 6d5500ac…   + # source-commit: 7dffb032…
  L3 - # source-sha256: 2bf46cbd…   + # source-sha256: 4497b38c…
  only header lines changed = true
bodyHash(head body)        = 0e6b7094deafa61e0525d617f792a8da30b9aeba1a3c72cb221ee4061f783ed3
meta content-sha256 (head) = 0e6b7094deafa61e0525d617f792a8da30b9aeba1a3c72cb221ee4061f783ed3
content-sha256 matches body = true
body identical prev vs head = true  (55 lines)
sourceFingerprint(repo)     = 4497b38cdf7d4fcb457736d941d9b49c58808f82e9d00bf91b8cc64861fabdf9
meta source-sha256 (head)   = 4497b38cdf7d4fcb457736d941d9b49c58808f82e9d00bf91b8cc64861fabdf9
source-sha256 matches       = true
body lines containing a title string = 0
body lines that look like they carry free text = 0
```

So the frozen 250 px signature is a **structure/style/flags** signature — every body line is `tag key=… class=… style=… flags=…`, with no text payload — which is exactly why a title-only source edit (the rebrand) cannot change it. The body and its hash are byte-identical to the v0.17.0 freeze, the recomputed `content-sha256` matches the body, and the recomputed `source-sha256` matches the new header. The re-freeze is legitimate; nothing was laundered. (Baseline had this test red with `fixture 内容 hash 与正文不一致（被手改过？）`; it is now green — the single V7 improvement.)

### 12.4 V3/V4 re-issued on the **real 0.2.0-rc.2 host** — PASS

The runtime was installed from the configured registry — `npm view @deepseek-ai/dsh@0.2.0-rc.2` → `version = '0.2.0-rc.2'`, dist-tag `latest = 0.2.0-rc.2`; `pnpm add @deepseek-ai/dsh@0.2.0-rc.2` → 531 packages in 19.8 s; the installed CLI reports **`0.2.0-rc.2`**. Instance: `DSH_HOME=./tmp/verify-rc2/home`, workspace `./tmp/verify-rc2/ws`, **port 3083** (19387/3080 untouched), plugin installed with the *real* route `dsh plugin --profile web add "link:C:/…/Temp/gd-verify-rc2"` (space-free copy of the final `dist/`, hashes equal to the repo's).

```
--dump-config    → # == goal-dashboard / - id: dsh-graph-host / name: goal-dashboard / config.root: .dsh-graph
profile manifest → dsh.profile.bundles: [@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, goal-dashboard]
plugin log       → [dsh-graph-host] apply: tools + /api/dsh-graph(+goal+write) registered
marker.json      → plugin=dsh-graph-host tools=54 validate=PASS  (incl. graph_workflow_list/start/advance/status, graph_skills_catalog)

GET /?token (303) → GET / (200 text/html 35120 B); __DSH_BOOT__ present, "goal-dashboard"×5 / "dsh-graph"×0
ROW  {"id":"goal-dashboard","url":"plugins/??goal-dashboard/client.js&rev":"3c1966f44a43","rev":"3c1966f44a43",
      "inject":["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-settings",
                "@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-client-ui-sidebar-right"]}
GET /plugins/??goal-dashboard/client.js&rev=3c1966f44a43 -> 200 text/javascript; charset=utf-8 bytes=908248
      bundle loader id = goal-dashboard          (expected goal-dashboard)
NEGATIVE wrong rev   -> 404      NEGATIVE unknown pkg -> 404      /plugins/goal-dashboard/client.js -> 404
combo batch (8 loader ids, includes goal-dashboard) -> 200 text/javascript bytes=1811516

GET /api/dsh-graph/workflow?workspace=<ws>&goal=g-002 -> 200 {"goal","workflow","presets","catalog"}
      workflow=wf-1d074a86 stage=grill 1/6 status=active state=active,pending,pending,pending,pending,pending
      presets=5  catalog=37
GET /api/dsh-graph/workflows?workspace=<ws>           -> 200 {"active":[…wf-1d074a86…]}
NEGATIVE /workflow without goal                       -> 400 {"error":"missing goal"}
```

Served bytes are the committed artifact: `tmp/verify/compare-served.mjs` → served 908 248 B minus the host's trailer = 908 179 B = `dist/lib/client.js` (908 176 B) + the host's own `"\n;\n"` separator; **common prefix identical**, same SHA-256 pattern as the 0.1.5-rc.3 run (`37b7fe06…` after stripping only the trailer).

**Version-specific differences worth recording** (both hosts behave correctly, but the wire format differs):
* 0.1.5-rc.3 advertises **root-absolute** row URLs (`/plugins/??…`); **0.2.0-rc.2 advertises document-relative URLs** (`plugins/??…`) and HTML-escapes `&` as `&amp;`. A checker that string-compares against `/plugins/<pkg>/client.js` must be written for the version it targets; the harness now normalises both.
* Revision tokens differ in shape (`d241fd814a0bd615-48` vs `887ce540d83e` / `3c1966f44a43`); only the advertised URL is served, and a wrong rev 404s on both.
* Neither host serves the bare, non-revisioned `/plugins/<pkg>/client.js` (404 on both) — the V3 acceptance criterion as originally written does not hold on either host version.

### 12.5 Residual risk after the final pass

* The desktop **Electron shell** (the app window boot, its own `__DSH_BOOT__` injection and asset serving from `app.asar`) is still not exercised; what is proven on 0.2.0-rc.2 is the DSH runtime + plugin tree + client-modules route, not the desktop wrapper.
* No browser was used, so "served, identified, revision-pinned" is not "rendered"; the workflow strip's visible output remains unverified (§9.3).
* LLM-driven tool execution remains unverified (§9.4); the workflow tools are proven *registered* on both hosts and their core functions are proven by direct exercise (§7).
* 103 pre-existing failures remain (Windows env/EOL, per §12.3(a)). The suite is not green, and this report does not claim it is.
* The `dsh plugin add` space bug (§12.3 alternative: see V1.13 / §2) is upstream and unfixed.
* **Desktop-profile observation (not caused by this verifier).** At the first pass the live profile `C:\Users\silence\.dsh\profiles\desktop\package.json` was `mtime 2026-10-02T09:40:41+08:00` with `"dsh-graph": "^0.17.0"` in `dependencies` and no graph/dashboard entry in `dsh.profile.bundles`. At teardown of the final pass the same file is `mtime 2026-10-02T10:32:41+08:00` and its `dependencies` section is **gone entirely** (`dependencies: undefined`), while `bundles` still contains no `dsh-graph`/`goal-dashboard`. This verifier never wrote to that path (every write went to `./tmp/verify*` or `%TEMP%`); the change came from another actor (the live GUI/plugin manager or the Lead). It does not affect any verdict here — the desktop profile was only ever *read* — but the earlier "untouched" statement in §4/V3.5 covers the first pass only.
