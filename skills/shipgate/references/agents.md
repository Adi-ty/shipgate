# Agents — intent capture and the invocation seam

shipgate is harness-agnostic. The two agent-specific concerns — reading the session
transcript (for `intent`) and invoking the agent (for review/auto-fix) — sit behind one
`AgentAdapter` interface. v1 ships exactly one implementation: Claude Code. Adding another
harness (Pi, opencode) is one new file, no pipeline changes.

## How `intent` reads the Claude Code session

When you run `shipgate intent`, the Claude Code adapter:

1. Computes the project's transcript directory by escaping the repo path
   (`/` → `-`): `/Users/me/proj` → `~/.claude/projects/-Users-me-proj/`.
2. Lists `*.jsonl` transcripts there (each file is named `<sessionId>.jsonl`), newest
   first by mtime.
3. Parses the newest one: pulls genuine user prose (string content, or `text` blocks in
   array content), skipping tool-result turns and command wrappers.
4. Emits `{ summary, sessionId, source: "claude-code", matchScore, userTurns }`.
   - `summary` = the first user prompt (whitespace-condensed, truncated ~600 chars) — the
     gold signal for "what was this session trying to do."
   - `matchScore` = `1.0` for a single transcript; `0.6` when several exist (it picked the
     newest — treat as a hint and confirm if it looks off).

This is pure, deterministic file reading — **no AI**. It degrades gracefully: no transcript
→ `skipped` (`intent.no-transcript`), and you can always pass `--intent "<text>"`
(`source: "manual"`).

The `summary` flows downstream: `pr` uses it as the PR body, and `doc --intent "<summary>"`
uses it for the changelog bullet. So run `intent` first and thread its `data.summary` into
those steps.

## The invocation seam (review / auto-fix)

The adapter also exposes a headless `invoke(prompt)` (runs `claude -p "<prompt>"`). In the
in-session flow you usually *are* the agent — you read `review`'s diff and judge it
directly, rather than the CLI spawning a second agent. The `invoke` seam exists so a
future headless mode (or a different harness) can drive review/auto-fix without changing
the pipeline. You generally don't call it yourself during an interactive ship.

## Why this matters to you

When `intent` is `skipped`, don't treat it as a failure — it just means there's no
transcript for this repo (e.g. a fresh clone, or you launched elsewhere). Supply
`--intent` and continue; the rest of the pipeline doesn't depend on intent except for the
PR body and changelog text, which you can write yourself.
