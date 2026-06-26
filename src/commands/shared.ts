import { execShell } from "../core/exec.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import type { ResolvedCommand } from "../core/stacks/adapter.js";
import type { GitPort } from "../ports/git.js";

/** Keep only the last `n` characters of captured output for evidence. */
export function tail(s: string, n = 4000): string {
  return s.length > n ? s.slice(-n) : s;
}

/**
 * Resolve a base branch name into a ref usable for diffs: prefer the
 * remote-tracking ref `<remote>/<base>`, else a local branch `<base>`, else null.
 */
export async function resolveBaseRef(
  git: GitPort,
  repoRoot: string,
  remote: string,
  base: string,
): Promise<string | null> {
  if (await git.remoteBranchExists(repoRoot, remote, base)) return `${remote}/${base}`;
  try {
    await git.revParse(repoRoot, base);
    return base;
  } catch {
    return null;
  }
}

/**
 * Run a resolved command and classify its exit into a StepResult:
 *  - exit 0          → passed
 *  - exit 127        → failed (command/tool not installed) — needs a human
 *  - other non-zero  → findings, action auto-fix (the agent should fix the code)
 *
 * The classification is stack-agnostic: it reads the exit code, never the tool.
 */
export async function runCommandStep(args: {
  step: "lint" | "test";
  resolved: ResolvedCommand;
  repoRoot: string;
  extraData?: Record<string, unknown>;
  extraEvidence?: Record<string, unknown>;
}): Promise<StepResult> {
  const { step, resolved, repoRoot } = args;
  const r = await execShell(resolved.shell, { cwd: repoRoot });

  const data: Record<string, unknown> = {
    command: resolved.shell,
    source: resolved.source,
    ...(resolved.adapter ? { adapter: resolved.adapter } : {}),
    ...args.extraData,
  };
  const evidence: Record<string, unknown> = {
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    stdoutTail: tail(r.stdout),
    stderrTail: tail(r.stderr),
    ...args.extraEvidence,
  };

  if (r.exitCode === 0 && !r.timedOut) {
    return stepResult({ step, status: "passed", data, evidence });
  }

  if (r.exitCode === 127) {
    const label = step === "lint" ? "Lint" : "Test";
    return stepResult({
      step,
      status: "failed",
      findings: [
        finding({
          id: `${step}.command-not-found`,
          severity: "error",
          action: "ask-user",
          message: `${label} command not found (exit 127): '${resolved.shell}'. Is the tool installed?`,
          data: { exitCode: 127 },
        }),
      ],
      data,
      evidence,
    });
  }

  const problem = step === "lint" ? "Lint reported problems" : "Tests failed";
  return stepResult({
    step,
    status: "findings",
    findings: [
      finding({
        id: `${step}.failed`,
        severity: "error",
        action: "auto-fix",
        message: `${problem} (exit ${r.exitCode}).`,
        data: { exitCode: r.exitCode },
      }),
    ],
    data,
    evidence,
  });
}
