# The StepResult / Finding schema

Every shipgate command emits one `StepResult` as JSON. This is the contract you read
after each step. It is schema-stable — field names won't shift under you.

```ts
type Severity = "error" | "warning" | "info";
type Action   = "auto-fix" | "ask-user" | "no-op";
type Status   = "passed" | "findings" | "skipped" | "failed";

interface Finding {
  id: string;                 // stable, dotted, e.g. "lint.failed", "review.gate"
  severity: Severity;
  action: Action;             // what YOU do about it
  message: string;            // human-readable
  location?: { file: string; line?: number };
  data?: Record<string, unknown>;   // finding-specific (e.g. conflictedFiles, candidates)
}

interface StepResult {
  step: string;               // "base", "rebase", "lint", …
  status: Status;
  findings: Finding[];
  data?: Record<string, unknown>;     // machine-readable decisions you act on
  evidence?: Record<string, unknown>; // raw context for HOW to fix / audit
}
```

## status — what it means for flow control

| status | meaning | what you do |
|--------|---------|-------------|
| `passed` | step verified clean | move to the next step |
| `skipped` | nothing to do, or a deliberate signal | move on, but check `data` for signals (e.g. `rebase`'s `skipRemaining`) |
| `findings` | the step has results to act on | inspect each finding's `action` |
| `failed` | the command/tool itself errored | usually an environment problem — **stop and tell the human** |

## action — your instruction per finding

The action is the whole point: it tells you, the agent, what to do without you having to
infer it. Treat it as authoritative.

- **`auto-fix`** — the problem is in the code and you can fix it. The cause is in
  `evidence` (`stdoutTail` for test/lint). Edit the code, re-run the same command. Loop is
  **bounded to 3 attempts** — if it's still failing after three honest tries, stop and ask
  the human, because a fourth identical attempt usually means you've misdiagnosed it and
  grinding erodes trust.
- **`ask-user`** — a human decision or a clean environment is required (ambiguous base, a
  merge conflict, a missing tool, red CI, the review gate). **Pause. Present the finding's
  `message` and relevant `data`. Do not guess past it.** This is the mechanism that keeps
  shipgate from confidently shipping the wrong thing.
- **`no-op`** — informational. Note it (it may be a hint worth acting on, like
  `doc.api-surface`), but it never blocks.

## A few findings are special signals, not problems

- `rebase.no-diff` (no-op) rides on `status: "skipped"` + `data.skipRemaining: true` —
  it means the branch is empty vs base, so **stop the whole pipeline**.
- `review.gate` (ask-user) is always present on a non-empty review — it is the human
  approval gate, not a defect.
- `*.no-command` (no-op, skipped) means no test/lint command was resolved for this stack —
  not a failure. See `stacks.md` to configure one.

## Exit codes (when you read the process exit instead of JSON)

`passed`/`skipped` → `0`. `failed` → `1`. `findings` → `1` if any finding's action is not
`no-op`, else `0`. So a step that only produced informational findings still exits `0`.
Prefer reading the JSON `status`/`findings` over the exit code when you can.
