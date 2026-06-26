---
name: shipgate
description: Ship an AI agent's rough changes through shipgate's validation pipeline — capture intent, resolve the base branch, rebase, review the diff, test, document, lint, push, open the PR, and watch CI — reading each command's JSON to decide auto-fix vs pause-for-human. Use when the user asks to "ship", "ship it", "run shipgate", or open a clean PR from the current branch.
---

# shipgate — pipeline brain

You orchestrate the `shipgate` CLI. **You are the brain; the CLI is the hands.** Each
command is deterministic, shells out to real tools, and emits a typed `StepResult` as
JSON when you pass `--json`. Your job is to run the steps in order, read their JSON, and
decide what to do next. Never reimplement what a command does — call the command.

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
- Decision values live in `data` (e.g. `data.resolvedBase`, `data.skipRemaining`);
  `evidence` is raw detail for your reasoning (diffs, tool output, candidate distances).

## The fixed step order

Run from the repo you want to ship. Do not reorder.

### 1. intent — capture what the session was trying to do (for the PR body)
```
shipgate intent --json
```
- `passed` → keep `data.summary` (and `data.sessionId`); it seeds the PR body and the
  changelog. `data.matchScore < 1` → several transcripts exist; treat as a hint.
- `skipped` (`intent.no-transcript`) → pass `--intent "..."` or write the body yourself.
Informational — never gates, never decides the base.

### 2. base — resolve the integration branch
```
shipgate base --json
```
- `passed` → read `data.resolvedBase` (use it for every later `--base`). Note `data.rule`.
- `findings`/`ask-user` (ambiguous / missing override) → **stop**, show candidates, ask.

### 3. rebase — rebase the run branch onto the resolved base
```
shipgate rebase --base <data.resolvedBase> --json
```
- `skipped` + `data.skipRemaining === true` → branch is empty vs base; **stop**, nothing to ship.
- `findings` (conflict → `ask-user`) → **stop**; the human resolves it.
- `passed` → continue.

### 4. review — always pause for a human
```
shipgate review --base <resolvedBase> --json
```
- `skipped` (`review.no-changes`) → nothing to review; continue.
- `findings` → read `evidence.diff` and **review the change yourself**. If you find
  issues, you may write them to a JSON file and re-run with `--findings-file <path>` to
  record them. The result always carries a `review.gate` `ask-user` finding:
  **present your review and STOP for human approval before continuing.**

### 5. test — with the auto-fix loop
```
shipgate test --json
```
- `passed`/`skipped` → continue. `failed` (exit 127) → **stop**; runner not installed.
- `findings`/`auto-fix`: read `evidence.stdoutTail`, fix code/tests, re-run, at most
  **3 times**, then **stop** and ask the human.

### 6. doc — close doc/changelog gaps
```
shipgate doc --base <resolvedBase> --intent "<data.summary from step 1>" --json
```
- `passed` → check `data.applied` (a changelog bullet may have been added) and any
  `no-op` notes (`doc.api-surface`, `doc.no-changelog`) — address docs if warranted.
- `findings`/`auto-fix` (`doc.changelog-gap`): add the changelog entry yourself, then
  continue.

### 7. lint — with the auto-fix loop
```
shipgate lint --json
```
- `passed`/`skipped` → continue. `failed` (exit 127) → **stop**; tool not installed.
- `findings`/`auto-fix`: run `shipgate lint --fix --json`, re-run `shipgate lint --json`;
  if still failing, read `evidence.stdoutTail`, fix the code, re-run — at most **3 times**,
  then **stop** and ask the human.

### 8. push — publish the validated run branch
```
shipgate push --run-branch <branch> --json
```
- `passed` → continue. `failed` (`push.failed`) → **stop**; show `evidence.stderrTail`.

### 9. pr — create or update the pull request
```
shipgate pr --base <resolvedBase> --run-branch <branch> --json
```
- Body is built from the `intent` summary automatically; `--title`/`--body` override.
- `passed` → note `data.action` + `data.url`. `failed` (`pr.failed`) → **stop**.

### 10. ci-watch — wait for CI + mergeability
```
shipgate ci-watch --run-branch <branch> --json
```
- `passed` → green and mergeable — **done**.
- `findings`: `ci.failed` (fix checks), `ci.not-mergeable` (rebase + re-push from step 3),
  or `ci.timeout` → **stop** and report.
- `skipped` (`ci.no-pr` / `ci.no-checks`) → nothing to wait on.

### finish
Summarize: resolved base + rule, commits rebased, the review outcome (human-approved?),
test + lint results (and any auto-fixes), doc/changelog updates, the PR URL, and the CI
result.

## Isolation (optional but recommended)

Run the pipeline in a disposable sandbox instead of the live checkout:
```
shipgate worktree create --json     # → data.path, data.branch
# ... run the steps against the run branch ...
shipgate worktree remove --json
```

## Gates — non-negotiable

- **`review` always stops for human approval.** Never skip the `review.gate`.
- **Any `ask-user` finding → pause for the human.** Never auto-pick a base, never force
  past a rebase conflict, never silence a failing tool or a red CI.
- Auto-fix loops are **bounded** (3 attempts each). When the budget is spent and blocking
  findings remain, pause — do not keep grinding.
- A `failed` status is an environment problem, not a code problem — surface it, don't fix.
