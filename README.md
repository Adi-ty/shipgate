# shipgate

A post-session "ship-it" pipeline for code written by an AI coding agent. After an
agent finishes editing, shipgate takes the rough changes through a fixed validation
pipeline in an isolated worktree and produces a clean, tested, documented pull request —
pausing for a human only when judgment is genuinely required.

The package has two halves that talk through structured JSON:

- **The CLI is the hands** — deterministic subcommands that shell out to real tools
  (git, gh, and whatever test/lint commands the resolved stack adapter provides). No AI
  calls. Every command that produces findings supports `--json` and emits a typed,
  schema-stable [`StepResult`](src/core/findings.ts).
- **The SKILL.md is the brain** — the prose contract an agent loads to know the step
  order, the human-approval gates, the auto-fix loop, and when to call each CLI command.
  *(authored in a later slice)*

The pipeline owns **zero hardcoded tool knowledge**: it detects the project's stack and
resolves what to run through a pluggable adapter layer, and a `.shipgate.yaml` override
always wins. Works for any stack — Node, PHP/WordPress, Python, Go, …

## Status — vertical slice 1

The riskiest plumbing, built end-to-end and tested against real throwaway git repos:

| Command | What it does |
|---|---|
| `shipgate worktree create\|remove` | disposable detached worktree on a run-scoped branch (`IsolationProvider`, host impl) |
| `shipgate base` | resolve the integration/base branch (open-PR → override → nearest-divergence → ambiguous-ask-user); never hardcodes `main` |
| `shipgate rebase` | fetch + rebase the run branch onto the resolved base; emits a "no diff → skip rest" signal |

The remaining commands (`intent`, `review`, `test`, `doc`, `lint`, `push`, `pr`,
`ci-watch`), the stack/agent adapters, and the authored `SKILL.md` land in later slices.
The port/interface seams (`StackAdapter`, `AgentAdapter`, `IsolationProvider`) are
designed so each is a one-file addition with no pipeline changes.

## Develop

```bash
npm install
npm run build     # tsc → dist/ (the published bin: shipgate → dist/cli.js)
npm test          # vitest: real git against throwaway repos; only gh/network is mocked
npm run lint      # tsc --noEmit over src + test
```

Requires Node ≥ 20, git, and (for the eventual `pr`/`ci-watch` steps) the GitHub CLI `gh`.
