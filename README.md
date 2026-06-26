# shipgate

A post-session "ship-it" pipeline for code written by an AI coding agent. After an
agent finishes editing, shipgate takes the rough changes through a fixed validation
pipeline in an isolated git worktree and produces a clean, tested pull request — pausing
for a human only when judgment is genuinely required.

It works for any stack (Node, PHP/WordPress, Python, Go, …): it detects the project's
stack and resolves what to run, and a `.shipgate.yaml` override always wins.

## Install

```bash
npm install -g shipgate   # or: npx shipgate <command>
```

Requires Node ≥ 20 and git (and `gh` for the GitHub steps).

## Usage

Every command is non-interactive and supports `--json` for machine-readable output.

```bash
shipgate worktree create        # isolated detached worktree on a run-scoped branch
shipgate base                   # resolve the integration/base branch
shipgate rebase --base <branch> # rebase the run branch onto the resolved base
shipgate lint [--fix]           # run the project's lint command (auto-fix optional)
shipgate test                   # run the project's test command
shipgate worktree remove        # tear down the worktree
```

### Configuration

Drop a `.shipgate.yaml` at the repo root to override the auto-detected commands:

```yaml
commands:
  test: npm test
  lint: npm run lint
  format: npm run format
```
