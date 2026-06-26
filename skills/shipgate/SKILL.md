---
name: shipgate
description: >-
  Use when finishing or shipping an AI agent's changes — run the validation pipeline
  that turns a rough branch into a clean, verified pull request: capture intent, resolve
  the base, rebase, review the diff, test, document, lint, push, open the PR, and watch
  CI. Triggers on "ship", "ship it", "ship this branch", "run shipgate", "open a PR",
  "validate / clean up / finish these changes before they go out", or when a shipgate
  step has gone red and needs to be made green.
compatibility: >-
  Requires the `shipgate` CLI on PATH (Node >= 20), git, and `gh` for the push/pr/ci-watch
  steps. Filesystem-based agent with bash.
---

# shipgate

You orchestrate the `shipgate` CLI. **You are the brain; the CLI is the hands.** Each
command is deterministic, shells out to real tools, does no AI work itself, and emits a
typed `StepResult` as JSON. Your job is one loop, repeated per step:

> **run the step → read its JSON → verify the outcome → fix what's fixable → re-run; pause for the human at a gate.**

Never reimplement what a command does — call the command and react to its JSON.

## When to use

Use this skill whenever changes are finished (or nearly finished) and need to become a
clean, merge-ready PR — and whenever a shipgate step has gone red and the user wants it
made green. Concretely:

- "ship this branch", "ship it", "run shipgate", "open a clean PR from my current work".
- Validate / clean up / finish changes before they go out — rebase onto the right base,
  review the diff, run tests and lint, update docs, push, and open the PR.
- A step failed (lint or tests red, CI failing, a rebase conflict) and you need it
  diagnosed, fixed, and re-run to green.
- You're an agent that just finished editing and want to self-check before handing back.

Not for: writing fresh code unrelated to shipping, or one-off git/gh commands the user
asked for directly — just run those.

## Inputs required

- A git repo with the work on a branch (the **run branch**; default: the current branch).
- The `shipgate` CLI on PATH. Run **every** command with `--json` and read the result.
- For `push`/`pr`/`ci-watch`: a configured remote and an authenticated `gh`.
- Optional `.shipgate.yaml` (test/lint/format commands, base rules, push target).
  See: `references/stacks.md`.

## How to read a StepResult

```json
{ "step": "...", "status": "passed|findings|skipped|failed", "findings": [...], "data": {...}, "evidence": {...} }
```

- **status** — `passed` (move on), `skipped` (move on; check `data` for signals like
  `skipRemaining`), `findings` (inspect them), `failed` (the tool itself errored — usually
  an environment problem; stop and tell the human).
- **findings[].action** — `auto-fix` (you fix it, re-run), `ask-user` (**stop, hand to the
  human**), `no-op` (informational).
- **data** = decisions you act on (`resolvedBase`, `skipRemaining`, `url`). **evidence** =
  raw context for *how* to fix (`stdoutTail`, the diff, CI checks).

Full schema + every finding id: `references/findings.md`.

## Procedure

Run from the repo (or an isolated worktree — see below). Carry `data.resolvedBase` from
step 2 into every later `--base`. Pass `--json` every time.

| # | Command | Verify / act on |
|---|---------|-----------------|
| 1 | `shipgate intent --json` | Keep `data.summary` (PR body + changelog seed). `skipped` → pass `--intent "…"`. Never decides the base. |
| 2 | `shipgate base --json` | `passed` → use `data.resolvedBase`. `ask-user` (ambiguous/missing) → **stop, show candidates**. |
| 3 | `shipgate rebase --base <resolvedBase> --json` | `skipped` + `data.skipRemaining` → **stop, nothing to ship**. conflict → **stop**. |
| 4 | `shipgate review --base <resolvedBase> --json` | Read `evidence.diff`, **review it yourself** (record findings via `--findings-file` if useful). Always carries `review.gate` → **present your review and STOP for human approval.** |
| 5 | `shipgate test --json` | `findings`/auto-fix → fix **test-first** (below), re-run until green (≤3×). |
| 6 | `shipgate doc --base <resolvedBase> --intent "<summary>" --json` | Check `data.applied`; `doc.changelog-gap`/auto-fix → add the entry. |
| 7 | `shipgate lint --json` | `findings`/auto-fix → `shipgate lint --fix --json`, re-run; else fix from `evidence.stdoutTail` (≤3×). |
| 8 | `shipgate push --run-branch <branch> --json` | `failed` → **stop**, show `evidence.stderrTail`. |
| 9 | `shipgate pr --base <resolvedBase> --run-branch <branch> --json` | Body comes from intent. Note `data.action` + `data.url`. `failed` → **stop**. |
| 10 | `shipgate ci-watch --run-branch <branch> --json` | `passed` → green + mergeable, **done**. `ci.failed`/`not-mergeable`/`timeout` → fix loop, see `references/fixing.md`. |

Exact flags + JSON for any step: `references/commands.md`.

## Verification

A ship is done only when each of these is true from the actual JSON (not your assumption):

- `base` resolved (note the rule) and `rebase` passed — or `skipped` because the branch is
  empty (then you're done; nothing to ship).
- `review` was presented and **a human approved it**.
- `test` `passed` and `lint` `passed` — and after any `--fix`, a **plain re-run** returned
  `passed` (a fix isn't real until the step re-runs clean on its own).
- `doc` either applied an entry (`data.applied`) or reported the gap.
- `push` passed; `pr` returned a `data.url`; `ci-watch` returned `passed`.

## Failure modes & fixing (test-driven)

shipgate verifies; **you** fix, and a fix is only real once the step re-runs green. When a
step is red, make it green **test-first** — this is how you avoid "fixes" that don't
actually fix:

- **A failing test is your red.** Read `evidence.stdoutTail`, understand *why* it failed,
  change the **code** until it passes. **Never edit a test just to make it pass** — that
  hides the bug instead of fixing it.
- **If a defect has no test** (a bug review surfaced, or a CI failure no local test
  catches): **write a failing test that reproduces it first**, watch it go red, then fix
  the code until it's green. The new test ships with the change and guards the regression.
- **Never "fix" code you haven't watched fail.** If you can't make it go red→green, you
  don't yet understand the failure — say so rather than guessing.
- **Lint** is mechanical, not TDD: run `shipgate lint --fix`, then re-run `shipgate lint`.
- **Bound every fix loop to ~3 attempts.** Still red? Stop and hand the human what you
  tried and what still fails — a fourth blind attempt erodes trust.
- **CI failures** are remote — the cause isn't in the result. Fetch it (`gh run view
  --log-failed`), then apply the same test-first fix and loop back through `push` →
  `ci-watch` (≤2 rounds).

The full per-step playbook (commands, the CI recovery sequence, what's fixable vs not):
`references/fixing.md` — load it the moment a step returns `findings` or `failed`.

## Escalation — when to STOP for the human (non-negotiable)

- **`review` always stops for human approval** — `review.gate` is not optional.
- **Any `ask-user` finding → pause.** Never auto-pick a base, force past a conflict,
  silence a missing tool, or merge over red CI.
- **`failed` is an environment problem** (missing tool, auth, no GitHub host) — surface
  the message; don't try to "fix" it in code.
- When you stop, give the human the finding's `message`, the relevant `data`/`evidence`,
  and a one-line recommendation.

## Isolation (recommended)

Run the pipeline in a disposable sandbox so the live checkout is untouched:
```
shipgate worktree create --json     # → data.path, data.branch (shipgate/run-<id>)
# ... run the steps against data.branch ...
shipgate worktree remove --json
```

## References (load on demand)

- `references/commands.md` — every command: flags, exact JSON, status + finding ids.
- `references/findings.md` — the StepResult/Finding schema, the action model, exit codes.
- `references/fixing.md` — the test-driven verify→fix playbook, incl. the CI recovery loop.
- `references/stacks.md` — how `test`/`lint` resolve commands; the `.shipgate.yaml` override.
- `references/agents.md` — how `intent` reads the session transcript; the invocation seam.
