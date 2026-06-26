---
name: shipgate
description: Ship an AI agent's rough changes through shipgate's validation pipeline — resolve the base branch, rebase, lint (auto-fixing), and test in order, reading each command's JSON to decide auto-fix vs pause-for-human. Use when the user asks to "ship", "ship it", "run shipgate", or open a clean PR from the current branch.
---

# shipgate — pipeline brain

You orchestrate the `shipgate` CLI. **You are the brain; the CLI is the hands.** Each
command is deterministic, shells out to real tools, and emits a typed `StepResult` as
JSON when you pass `--json`. Your job is to run the steps in order, read their JSON, and
decide what to do next. Never reimplement what a command does — call the command.

> Status: this CLI build implements `intent`, `worktree`, `base`, `rebase`, `lint`,
> `test`. The later steps (`review`, `doc`, `push`, `pr`, `ci-watch`) are not wired yet —
> stop after `test` and summarize.

## How to read every command's output

Always invoke with `--json`. Each result is:

```json
{ "step": "...", "status": "passed|findings|skipped|failed", "findings": [...], "data": {...}, "evidence": {...} }
```

- `status`: `passed` (move on), `skipped` (move on; may carry a skip signal), `findings`
  (inspect them), `failed` (a command/environment error — stop and tell the human).
- Each finding has an `action`:
  - `auto-fix` → fix it yourself, then re-run the step (bounded loop, below).
  - `ask-user` → **stop and hand control to the human**; do not guess.
  - `no-op` → informational only.
- The decision values you act on live in `data` (e.g. `data.resolvedBase`,
  `data.skipRemaining`). `evidence` is raw detail for your reasoning (tool output, etc.).

## The fixed step order

Run from the repo you want to ship. Do not reorder.

### 0. intent — capture what the session was trying to do (for the PR body)
```
shipgate intent --json
```
- `passed` → keep `data.summary` (and `data.sessionId`); it's the seed for the PR
  description. `data.matchScore < 1` means several transcripts exist — treat the summary
  as a hint and confirm with the human if unsure.
- `skipped` (`intent.no-transcript`) → no session transcript found; either re-run with
  `shipgate intent --intent "..."` or proceed and write the PR body yourself.

This step is **informational** — it never gates and is never used to decide the base.

### 1. base — resolve the integration branch
```
shipgate base --json
```
- `status: passed` → read `data.resolvedBase`; use it for the rebase. Note `data.rule`.
- `status: findings` with an `ask-user` finding (ambiguous base / missing override) →
  **stop**, show the candidate list, ask the human which base to use.

### 2. rebase — rebase the run branch onto the resolved base
```
shipgate rebase --base <data.resolvedBase> --json
```
- `status: skipped` and `data.skipRemaining === true` → the branch is empty vs base;
  **stop the whole pipeline** and report "nothing to ship".
- `status: findings` (rebase conflict → `ask-user`) → **stop**; the human resolves it.
- `status: passed` → continue.

### 3. lint — with the auto-fix loop
```
shipgate lint --json
```
- `passed` or `skipped` → continue.
- `failed` (e.g. `lint.command-not-found`, exit 127) → **stop**; tell the human the tool
  isn't installed.
- `findings` with `action: auto-fix`:
  1. Run `shipgate lint --fix --json` once (applies the mechanical, auto-fixable subset).
  2. Re-run `shipgate lint --json`. If `passed`, continue.
  3. If still `findings`, **read `evidence.stdoutTail`** to see the specific problems,
     edit the code to fix them, and re-run `shipgate lint --json`.
  4. Repeat step 3 at most **3 times**. If still failing, **stop** and ask the human.

### 4. test
```
shipgate test --json
```
- `passed` or `skipped` → done.
- `failed` (exit 127) → **stop**; runner not installed.
- `findings` with `action: auto-fix`: read `evidence.stdoutTail`, fix the code or tests,
  re-run `shipgate test --json`, at most **3 times**, then **stop** and ask the human.

### 5. finish
Summarize what ran: resolved base + rule, commits rebased, lint outcome (and whether you
auto-fixed), test outcome. State clearly that `review`/`doc`/`push`/`pr` are not yet
available in this build.

## Isolation (optional but recommended)

To run the pipeline in a disposable sandbox instead of the live checkout:
```
shipgate worktree create --json     # → data.path, data.branch
# ... run base/rebase/lint/test with the run branch ...
shipgate worktree remove --json
```

## Gates — non-negotiable

- **Any `ask-user` finding → pause for the human.** Never auto-pick a base, never force
  past a rebase conflict, never silence a failing tool.
- The auto-fix loops are **bounded** (3 attempts each). When the budget is spent and
  blocking findings remain, pause — do not keep grinding.
- A `failed` status is an environment problem, not a code problem — surface it, don't fix.
