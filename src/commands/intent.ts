import { ClaudeCodeAdapter } from "../core/agents/claude-code.js";
import type { AgentAdapter } from "../core/agents/adapter.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";

export interface IntentOptions {
  repo?: string;
  /** Manual intent override; skips transcript reading entirely. */
  intent?: string;
}

export interface IntentDeps {
  adapter?: AgentAdapter;
}

/**
 * `shipgate intent` — capture what the session was trying to do, for the PR body
 * and downstream prompts. Never used to decide the base branch. A `--intent`
 * override wins; otherwise the agent adapter reads the most recent session
 * transcript; if there is none, it degrades gracefully (skipped + a hint).
 */
export async function run(opts: IntentOptions, deps: IntentDeps = {}): Promise<StepResult> {
  const repoRoot = opts.repo ?? process.cwd();

  if (opts.intent && opts.intent.trim()) {
    return stepResult({
      step: "intent",
      status: "passed",
      data: { summary: opts.intent.trim(), sessionId: null, source: "manual", matchScore: 1, userTurns: null },
    });
  }

  const adapter = deps.adapter ?? new ClaudeCodeAdapter();
  const res = await adapter.resolveIntent(repoRoot);

  if (!res) {
    return stepResult({
      step: "intent",
      status: "skipped",
      findings: [
        finding({
          id: "intent.no-transcript",
          severity: "info",
          action: "no-op",
          message: `No ${adapter.name} session transcript found for this repo. Pass --intent "..." to set it manually.`,
        }),
      ],
      data: { summary: null, sessionId: null, source: "none", matchScore: 0 },
    });
  }

  return stepResult({
    step: "intent",
    status: "passed",
    data: { ...res.intent },
    evidence: { transcriptPath: res.transcriptPath, transcriptCount: res.transcriptCount },
  });
}
