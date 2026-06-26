# shipgate commands — the JSON contract

Every command accepts `--json` (emit the bare `StepResult`) and `--repo <path>` (default:
cwd). Exit code: `0` for `passed`/`skipped`, `1` for `failed` or `findings` containing any
non-`no-op` finding. Read `findings.md` for the shared schema.

## Contents
- [intent](#intent)
- [worktree create / remove](#worktree)
- [base](#base)
- [rebase](#rebase)
- [review](#review)
- [test](#test)
- [doc](#doc)
- [lint](#lint)
- [push](#push)
- [pr](#pr)
- [ci-watch](#ci-watch)

---

## intent
`shipgate intent [--intent "<text>"] [--json]`

Summarizes what the agent session was trying to do, for the PR body and the changelog.
Reads the most recent Claude Code session transcript (see `agents.md`). Never decides the
base branch.

- `--intent "<text>"` — set it manually; skips transcript reading entirely.
- **passed** — `data: { summary, sessionId, source: "claude-code", matchScore, userTurns }`,
  `evidence: { transcriptPath, transcriptCount }`. A `--intent` override gives
  `source: "manual"`, `matchScore: 1`.
- **skipped** — `intent.no-transcript` (no-op): no transcript found; pass `--intent`.

---

## worktree
`shipgate worktree create|remove [--run-id <id>] [--json]`

The isolation boundary: a disposable detached worktree on a run-scoped branch
`shipgate/run-<id>` at `<repo>/.git/shipgate/worktrees/<id>`.

- **create → passed** — `data: { runId, branch, path, detached: true }`, `evidence: { head }`.
- **remove → passed** — `data: { runId, removed }`, `evidence: { pruned, alreadyAbsent }`.
  Idempotent: removing an already-gone worktree still passes (`alreadyAbsent: true`).

---

## base
`shipgate base [--base <branch>] [--remote origin] [--run-branch <name>] [--intent-hint "<text>"] [--json]`

Resolves the integration/base branch. Never hardcodes `main`. `data.rule` says which rule
fired; `data.resolvedBase` is the answer (null when it can't decide).

Resolution order: (1) open PR's base wins; (2) `--base` or a `.shipgate.yaml` glob rule;
(3) nearest-divergence by commit distance; (4) tie → ask-user. Intent text is a weak hint
recorded in `evidence.intentHint`, never decisive.

- **passed** — `data: { rule, resolvedBase, runBranch }`. `rule` ∈ `open-pr`,
  `override-flag`, `override-config-glob`, `nearest-divergence`. `evidence.candidates`
  lists `{ branch, mergeBase, distance, chosen }` for the divergence path.
- **findings / ask-user** — `base.ambiguous` (tie; `finding.data.candidates`),
  `base.override-missing` (override points at a nonexistent branch), `base.no-candidates`.
  `data.resolvedBase: null`. **Stop and let the human pick.**
- **failed** — `base.gh-unavailable` (gh couldn't run, distinct from "no PR").

---

## rebase
`shipgate rebase --base <branch> [--remote origin] [--run-branch <name>] [--json]`

Fetches the base and rebases the run branch onto `<remote>/<base>`.

- **passed** — `data: { base, runBranch, commitsAhead, skipRemaining: false }`,
  `evidence: { rebasedOnto, diffStat }`.
- **skipped (the skip signal)** — `data.skipRemaining: true`, `data.skipReason:
  "no-diff-vs-base"`, finding `rebase.no-diff` (no-op). **Stop the pipeline — nothing to
  ship.**
- **findings / ask-user** — `rebase.conflict`; the rebase was aborted (`evidence.aborted:
  true`) so the tree is clean. `finding.data.conflictedFiles` lists the files. **Stop;
  the human resolves.**
- **failed** — `rebase.fetch-failed`.

---

## review
`shipgate review --base <branch> [--remote origin] [--run-branch HEAD] [--findings-file <path>] [--json]`

Packages the diff vs the resolved base for you to review and collects findings. **The CLI
does not judge the code — you do.** Review always gates on a human.

- `--findings-file <path>` — a JSON array of `Finding` objects you produced; merged into
  the result (invalid entries dropped). Use it to record your review findings in the schema.
- **findings** — always carries `review.gate` (ask-user). `data: { base, baseRef,
  runBranch, filesChanged, changedFiles }`, `evidence: { diff (capped ~100KB),
  diffTruncated, diffCommand, diffStat, agentFindings }`. Read `evidence.diff`, review,
  then **present your assessment and STOP for human approval.** If `diffTruncated`, run
  `evidence.diffCommand` to see the rest.
- **skipped** — `review.no-changes`. **failed** — `review.base-not-found`.

---

## test
`shipgate test [--json]`

Runs the resolved test command (stack-detected or `.shipgate.yaml` `commands.test`). See
`stacks.md` for resolution.

- **passed** — exit 0. `data: { command, source, adapter? }`, `evidence: { exitCode,
  durationMs, stdoutTail, stderrTail }`.
- **findings / auto-fix** — `test.failed`; tests failed. Read `evidence.stdoutTail`, fix
  the code/tests, re-run (≤3×).
- **skipped** — `test.no-command` (no command resolved). **failed** —
  `test.command-not-found` (exit 127 — runner not installed; an environment problem).

---

## doc
`shipgate doc --base <branch> [--remote origin] [--run-branch HEAD] [--intent "<text>"] [--json]`

Generically detects doc/changelog gaps for the diff (a heuristic multi-language public-API
scan + changelog detection) and applies the one safe update: a bullet under an existing
`## Unreleased` section. No stack-specific doc conventions.

- `--intent "<text>"` — text for the auto-applied changelog bullet (use the `intent`
  summary).
- **passed** — `data: { applied: [{type:"changelog-entry", file}], apiChanges, changelog,
  changelogChanged, sourceFiles }`. `applied` shows what was written; `apiChanges` lists
  `{ file, symbol, kind }`. May include `no-op` notes: `doc.no-changelog`,
  `doc.api-surface` (ensure docs cover the listed symbols).
- **findings / auto-fix** — `doc.changelog-gap`: a changelog exists but has no Unreleased
  section; add the entry yourself.
- **skipped** — `doc.no-changes`. **failed** — `doc.base-not-found`.

---

## lint
`shipgate lint [--fix] [--json]`

Runs the resolved lint command. `--fix` runs the adapter's auto-fixer first (e.g.
`npm run lint:fix`, `phpcbf`), then lints.

- **passed** — `data: { command, source, adapter?, fixApplied }`.
- **findings / auto-fix** — `lint.failed`. First run `shipgate lint --fix --json`, then
  re-run `shipgate lint --json`. If still failing, read `evidence.stdoutTail`, fix the
  code, re-run (≤3×).
- **skipped** — `lint.no-command`. **failed** — `lint.command-not-found` (exit 127).

---

## push
`shipgate push [--run-branch <name>] [--remote origin] [--url <fork-url>] [--json]`

Pushes the run branch. A named remote uses `--force-with-lease` (safe re-push after
rebase); `--url` (a fork) uses `--force`. Target resolves: `--url` → `--remote` →
`.shipgate.yaml` `push.url`/`push.remote` → `origin`.

- **passed** — `data: { branch, target, refspec, forced, forceWithLease }`.
- **failed** — `push.failed` (`evidence.stderrTail` has the reason), `push.no-run-branch`.

---

## pr
`shipgate pr --base <branch> [--run-branch <name>] [--title <t>] [--body <b>] [--body-file <path>] [--draft] [--json]`

Creates or updates the PR via gh. base = resolved branch. Title/body come from the
`intent` summary unless supplied. If an OPEN PR already exists for the head branch it is
edited rather than duplicated.

- **passed** — `data: { action: "created"|"updated", number, url, base, head, title }`.
- **failed** — `pr.failed` (gh error — often auth/permission), `pr.no-run-branch`,
  `pr.body-file`.

---

## ci-watch
`shipgate ci-watch [--run-branch <name>] [--interval 15] [--timeout 600] [--json]`

Polls CI + mergeability for the run branch's PR until terminal.

- **passed** — `data: { state: "passing", mergeable, number, url }` — green and mergeable.
- **findings / ask-user** — `ci.failed` (a check is red — fetch logs and fix, see
  `fixing.md`), `ci.not-mergeable` (green but conflicts — rebase + re-push), `ci.timeout`
  (still pending). `evidence: { polls, checks, mergeable }`.
- **skipped** — `ci.no-pr` (no open PR), `ci.no-checks` (no CI configured).
