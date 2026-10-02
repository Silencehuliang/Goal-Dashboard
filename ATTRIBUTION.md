# Attribution

Goal-Dashboard is a derivative work. This file records what came from where, under which license.

## 1. `dsh-graph` — the upstream this repository forks

- **Project:** [miuzel/dsh-graph](https://github.com/miuzel/dsh-graph) — "把工作组织成目标看板的 DeepSeek Harness (dsh) 插件"
- **Author / copyright:** Copyright © 2026 miuzel
- **License:** MIT
- **Fork point:** tag `v0.17.0`, commit `7dffb032dec2bd7a565cd383c82777cd29922099` (`release: v0.17.0`)
- **What we took:** the entire repository at that commit — the `core/` domain layer (goal state machine, entity model, append-only event log, workspace/root resolution, worktree handling), the `dsh-graph-host/` DSH adapter (`index.js` tools + REST endpoints, `lib/client/**` browser board), `schema/`, `docs/`, `scripts/`, `prompts/`, and the test suite.
- **Upstream is configured as a git remote**, so `git fetch upstream && git merge upstream/main` remains available.
- The original MIT license text is preserved verbatim at [`dsh-graph-host/LICENSE`](dsh-graph-host/LICENSE).

### What Goal-Dashboard changed

Identity and packaging only, plus a new skills layer. See the comparison table in [`README.md`](README.md). In short: package name `dsh-graph` → `goal-dashboard`; the repository root package is now the installable plugin manifest; `dist/` is committed so installation needs no build script (upstream's `prepare` script is removed); a `mattpocock/skills` workflow layer was added.

Deliberately **not** renamed, to avoid breaking existing data and user configuration: the `graph_*` tool names, the `/api/dsh-graph*` REST paths, the `.dsh-graph` data directory, the internal plugin id `dsh-graph-host`, and the `dsh-graph` settings namespace.

## 2. `mattpocock/skills` — the workflow source

- **Project:** [mattpocock/skills](https://github.com/mattpocock/skills) — "Skills for Real Engineers"
- **Author / copyright:** Copyright © 2026 Matt Pocock
- **License:** MIT
- **What we use:** the skill *catalogue* — names, categories, invocation kinds and descriptions — and the *workflow shape* of the engineering skills (`grill-with-docs` → `to-spec` → `to-tickets` → `implement` → `code-review` → `pr`, and the `bugfix` / `spec-first` variants).
- **How it is used:** the catalogue is embedded as data in `core/skills.ts` so the board can map workflow stages onto kanban lanes. The skill *bodies* are not vendored; users install the skills themselves from the upstream repository. Where a skill is present on disk, Goal-Dashboard can scan and use the local copy.
- **Upstream is not submoduled and not vendored** — only derived metadata is included, with attribution. A read-only reference clone used during development lives outside this repository.

## 3. License of this repository

Goal-Dashboard as a whole is distributed under the MIT license, consistent with both upstreams. Combined copyright notice:

```text
Copyright © 2026 miuzel                    (dsh-graph — upstream, MIT)
Copyright © 2026 Matt Pocock               (mattpocock/skills — workflow source, MIT)
Modifications Copyright © 2026 Silencehuliang  (Goal-Dashboard)
```

If you redistribute this work, keep this file and [`dsh-graph-host/LICENSE`](dsh-graph-host/LICENSE) with it.
