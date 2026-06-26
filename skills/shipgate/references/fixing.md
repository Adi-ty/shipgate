# Verify → fix playbook

shipgate verifies; **you** fix. A command tells you *what* is wrong and gives you the
context; you change the code or environment and re-run to confirm it's green. Load this
file whenever a step returns `findings` or `failed`.

The governing idea: a fix is only real once the step re-runs clean. So every fix ends with
re-running the command and reading its JSON again — not with you asserting it's fixed.

## Where the failure context lives (this determines how you fix)

| Step | Failure context is… | How you fix |
|------|--------------------|-------------|
| `test` | in `evidence.stdoutTail` | read the failure, edit code/tests, re-run `shipgate test` |
| `lint` | in `evidence.stdoutTail` | `shipgate lint --fix` first, then fix the rest from the output |
| `doc` | in `data` (`changelog`, `apiChanges`) | add the changelog/doc entry, re-run or continue |
| `ci-watch` | **remote — NOT in the result** | fetch logs with `gh`, then fix (see below) |
| `base`/`rebase`/`push`/`pr` | a decision or environment issue | usually **stop for the human** |

## Fixing code defects — test-driven (the `test` loop)

A fix is only real once you've watched it go **red → green**. Work test-first; it's what
separates a real fix from a plausible-looking edit that doesn't actually address the bug.

```
1. shipgate test --json
2. if findings/auto-fix (red):
     read evidence.stdoutTail — understand WHY the test failed
     change the CODE (not the test) to address that specific cause
     go to 1   # re-run to confirm green
3. after ~3 honest attempts still red → STOP; hand the human what you tried + what fails
```

Rules that keep this honest:

- **Never edit a test just to make it pass.** A green-by-deletion test hides the bug
  instead of fixing it. The test encodes the expected behavior; if it's genuinely wrong,
  say so and confirm with the human — don't silently weaken it.
- **If the defect has no test, write the failing test first.** When review surfaces a bug,
  or CI fails on something no local test covers, add a test that reproduces it, watch it go
  red, *then* fix the code until it's green. The new test ships with the change and guards
  the regression — that's the durable outcome, not just a one-time patch.
- **Don't fix code you haven't watched fail.** If you can't reproduce the failure as a red
  test, you don't yet understand it — investigate or escalate rather than guessing.
- **Bound the loop to ~3 attempts.** The first fix is usually right, the second catches a
  missed case, the third is the last honest try. Beyond that you're thrashing on a
  misdiagnosis; escalating with "here's what I tried and what still fails" beats a fourth
  blind guess.

`lint` is the exception — it's mechanical, not behavioral. Spend the first attempt on
`shipgate lint --fix --json` (whitespace, import order, simple style), then re-run
`shipgate lint --json` to confirm; only hand-edit from `evidence.stdoutTail` if something
remains.

## doc gaps

- `data.applied` already lists what shipgate wrote (a changelog bullet under `Unreleased`).
- `doc.changelog-gap` (auto-fix): the changelog has no `Unreleased` section — add one with
  an entry describing the change, then continue.
- `doc.no-changelog` / `doc.api-surface` (no-op): a changelog is absent, or public API
  changed — add or update docs for the listed symbols if the project warrants it. These
  don't block; use judgment.

## CI recovery loop (the important one)

CI runs on GitHub, so a red check's *cause* is not in the `ci-watch` result — you only get
`data.state: "failing"` and `evidence.checks` (which checks, not why). To make CI green you
have to go get the logs yourself, fix, and re-ship the branch. Bound this to ~2 rounds.

```
on ci.failed:
  1. fetch the failure logs directly (you have a shell):
       gh run view --log-failed                 # most recent run's failed jobs
       # or, scoped to the PR's checks:
       gh pr checks <branch>                     # see which checks failed
       gh run view <run-id> --log-failed         # full failed-step logs
  2. diagnose from the logs the same way you'd read evidence.stdoutTail locally
  3. fix the code; verify locally first when possible:
       shipgate test --json    and/or    shipgate lint --json
  4. re-publish and re-watch:
       shipgate push --run-branch <branch> --json
       shipgate ci-watch --run-branch <branch> --json
  5. if still failing after ~2 rounds → STOP, hand the human the logs + what you changed
```

Two related CI outcomes are handled differently:
- `ci.not-mergeable` (green checks, but conflicts): the base moved under you. Loop back to
  `shipgate rebase --base <resolvedBase>` → `push` → `ci-watch`. No log-fetching needed.
- `ci.timeout` (still pending past the window): not a failure. Re-run `ci-watch` (optionally
  a longer `--timeout`), or tell the human CI is slow.

## When to STOP instead of fix (don't be a hero)

These are `ask-user`/`failed` for a reason — pushing past them risks shipping the wrong
thing or corrupting state:

- `base.ambiguous` / `base.no-candidates` — you cannot know which branch the human intends.
- `base.override-missing` — the configured base doesn't exist; the config or the remote is wrong.
- `rebase.conflict` — a real merge conflict; needs human judgment. (The rebase already
  aborted, so the tree is clean — just stop.)
- `review.gate` — the whole point is human sign-off on the diff.
- `*.command-not-found` (exit 127) / `push.failed` / `pr.failed` — environment/auth/perms.
  Surface the message; a code edit won't fix a missing tool or a bad token.

When you stop, give the human the finding's `message`, the relevant `data`/`evidence`, and
a one-line recommendation — that's far more useful than silence or a blind retry.
