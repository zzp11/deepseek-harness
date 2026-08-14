---
name: dsh-workbench-local-test
description: Use when running, extending, or reporting local tests for the DSH 工作台 packages (packages/workbench/workbench, packages/client/workbench) — including TDD red-list passes over my_docs/仿真功能测试场景.md, choosing the narrowest lane that can judge a given step, and reporting red-green status with pasted real output. Use before claiming any workbench behavior works.
---

# DSH Workbench Local Test

The 工作台 is developed test-first against `my_docs/仿真功能测试场景.md`, whose steps are written to fail before they are implemented. This skill decides which lane can judge a step, runs it, and reports what actually happened.

**The one rule this skill exists to enforce:** a step is green only when a command was run and its output pasted. Never report a step from reading code, from a previous run, or from expectation. The project's own discipline states it as *不许凭印象声称"一致""已覆盖"* — run the checker and report its real output.

## Before anything: read the scenario and the design

1. `my_docs/仿真功能测试场景.md` — the steps, their `🤖`/`👁` and `⛔`/`✅` marks, and §九's judgment mapping.
2. `my_docs/06-阶段1-卡片工作台-设计方案.md` — what the step is supposed to prove and which clause of `10-设计说明.md` it comes from.

A step whose expected behavior you cannot trace to a clause is not ready to implement. Ask, or record it as `○` — never invent the expectation.

## Pick the narrowest lane that can judge the step

Match the lane to the surface. Running a broader lane is not extra rigor; it is slower feedback and a weaker signal about what broke.

| The step is about | Lane | Command |
|---|---|---|
| A pure derivation, gate, reducer, or plan function | **Unit** | `pnpm vitest run packages/workbench packages/client/workbench` |
| One React piece's rendering or a store transition | **Unit (client)** | `pnpm vitest run packages/client/workbench` |
| What the model sees: tool results, prompt text, refusal wording | **Snapshot** | `pnpm run test:snapshot -t <name>` |
| Real browser over the real assembled web composition | **Web e2e** | `pnpm run test:web` |
| Visual hierarchy, "can it be scanned in one glance", density | **Hand-driven browser** (`👁`) | see below — **not CI** |
| A repository invariant (design tokens, catalogs, docs) | **Gate** | the specific `scripts/verify-*.ts`, then `pnpm run doc-sync` |

Coverage is judged by `pnpm run test:coverage`, **not** `pnpm run test` — the per-file 100% gate on `packages/*/*/src` lives in the coverage lane. Both workbench packages are inside it.

## Lane: web e2e is the harness — do not hand-roll a browser

`apps/web/tests/**/*.e2e.ts` boots the real web composition in-process and drives real Chromium over real HTTP. It already owns modes, fixtures, and committed goldens. A workbench scenario belongs here.

**Add a scenario as a pair:**

- `apps/web/tests/workbench-<topic>.e2e.ts`
- `apps/web/tests/workbench-<topic>.overlay.yml` — the product overlay that mounts the two workbench plugins, applied after the shipped Web surface. This is the sanctioned composition seam; sibling examples: `goal-bar.overlay.yml`, `agent-preset-authoring.overlay.yml`.

Use `launchWebScaffold({ overlay })` from `apps/web/tests/scaffold.ts`. Modes ride `$DSH_SNAPSHOT`:

```sh
pnpm run test:web                      # replay committed goldens (keyless; what CI pins)
DSH_SNAPSHOT=refresh pnpm run test:web:built   # re-record with a real key
pnpm run test:web -t workbench         # one scenario while iterating
```

**Two constraints this lane enforces, both easy to violate:**

1. **These are Host-face tests.** They type-check in `tsconfig.host.json` and read Host services directly. Adding them to the Client aggregate makes every Host-service access fail to compile.
2. **Never import `@deepseek-ai/dsh-client-*` here** — a value or a type. It pulls the whole Client project graph into the Host build graph, which has already broken this lane once. When a scenario needs a Client-owned selector, class name, or copy string, **mirror it in the test file next to a commented-out import naming the source module**. Drift then shows up as a missed selector — a loud failure, never a silent pass.

Because of (2), assert on **product-visible text and roles**, not on CSS-module class names: hashed class names are not stable and mirroring them buys nothing.

## Lane: hand-driven browser, for the `👁` steps only

Five steps in the scenario have no mechanical judgment (§十.4). They are checked by eye, locally, and they **do not enter CI**. Writing them as automated assertions would be self-deception.

Port and state discipline:

- **Serve on 3081. Never touch 3080** — if something is listening there it is another instance, and `dev:web`'s HMR would hot-load a broken client bundle into it.
- Fresh `DSH_HOME`, `DSH_AGENTS_HOME`, workspace, and session state per run; a fresh isolated browser context.
- Read the key through the application's normal configuration path from root `.env`. Never echo a key value.
- Load the plugins with `--patch my_docs/workbench.patch.yml`.

For interaction and screenshots follow `record-browser-gif`'s browser-control and provenance rules rather than inventing a second convention: wait on a concrete UI condition (never a fixed delay), make completion predicates match **exact** text — a substring check is also satisfied by the echo of your own prompt.

**A GUI pull request needs a GIF.** The repository requires every pull request that changes product-user-visible GUI behavior to embed a demonstration GIF recorded from that pull request's real server and real model flow. Stage 1 is a GUI change, so plan that recording as part of the work, not after it.

## The TDD loop

Work one scenario step at a time. A step is done when its assertion exists, was red for the documented reason, and is now green.

1. **Locate the step** in `仿真功能测试场景.md` and note its lane from the table above.
2. **Write the assertion first, and run it.** Paste the failure. A step marked `⛔ 现在必失败` that passes on the first run is a bug in the assertion — it is testing something else. Find out what before continuing.
3. **For a new gate, inject what it must refuse and confirm it refuses**, before claiming it works. This is a hard project rule, not a preference.
4. **Implement the smallest change** that turns it green. Derived quantities go in the host `core.ts` **once** — store, tools, and the browser half only consume. The recorded failure behind this rule is one fact computed twice yielding two different values.
5. **Re-run that step's lane only.** Then run the lanes the change could have reached, and nothing else.
6. **Record any deviation** in `my_docs/04-实现偏差记录.md` as `D-nn`, in the project's three-part form: DSH 实际是什么 ／ 方案原本假设什么 ／ 你怎么改的.
7. **If the step cannot be implemented as specified**, change the design document and record the cost. **Never lower the scenario's expectation to make it pass.**

## Reporting

Report a table with one row per step attempted, and paste the real command output below it. Use exactly three states:

| State | Meaning |
|---|---|
| **绿** | Ran, passed, output pasted |
| **红** | Ran, failed, output pasted |
| **未跑** | Not attempted this pass |

`未跑` is a legitimate state and must never be reported as 绿. If a lane self-skipped for a missing key, say `未跑（无 key，自跳过）` — a skip is not a pass.

Separate **pre-existing failures** from yours. Verify the claim by stashing to a clean tree and re-running; state that you did. Two are known at stage 0: three `subagent-claude-code/real-product.spec.ts` cases that spawn the real Claude Code CLI, and `my_docs/README.md`'s missing bilingual counterpart, which reds `verify-translation-pairing` and therefore `doc-sync`.

Distinguish flakes from failures by re-running the file in isolation, and say which you did. A stage-0 example: the `app-boot` watcher specs fail under full-suite load and pass in isolation.

## Never

- Claim a behavior works without a pasted run.
- Report a skip, a stale result, or a passing sibling test as evidence for the step.
- Weaken a scenario expectation, a gate, or an assertion to reach green.
- Touch port 3080, or reuse state roots between runs.
- Substitute a mock, fixture query, or test-only hook where the step's evidence requires a real server or a real model round.
- Hand-roll a browser harness when `apps/web/tests` can host the scenario.
