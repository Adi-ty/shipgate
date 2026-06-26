import { ok } from "../core/exec.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import type { GitPort } from "../ports/git.js";

export interface RebaseInput {
  repo: string;
  runBranch: string;
  /** Resolved base branch name (without remote prefix). */
  base: string;
  remote?: string;
  git: GitPort;
}

/**
 * Fetch the base and rebase the run branch onto it.
 *
 * Outcomes:
 *  - passed  → rebased cleanly with commits ahead of base
 *  - skipped → no commits vs base after rebase (`data.skipRemaining: true`); the
 *              skill short-circuits the rest of the pipeline on this signal
 *  - findings/ask-user → conflict (the rebase is aborted first to leave a clean tree)
 *  - failed  → the base could not be fetched
 */
export async function rebaseStep(input: RebaseInput): Promise<StepResult> {
  const remote = input.remote ?? "origin";
  const { repo, runBranch, base, git } = input;
  const upstream = `${remote}/${base}`;

  const fetched = await git.fetch(repo, remote, base);
  if (!ok(fetched)) {
    return stepResult({
      step: "rebase",
      status: "failed",
      findings: [
        finding({
          id: "rebase.fetch-failed",
          severity: "error",
          action: "ask-user",
          message: `Could not fetch '${base}' from '${remote}': ${(fetched.stderr || fetched.stdout).trim()}`,
        }),
      ],
      data: { base, runBranch, commitsAhead: null, skipRemaining: false },
      evidence: { remote, fetchExitCode: fetched.exitCode },
    });
  }

  const rebased = await git.rebase(repo, upstream, runBranch);
  if (!ok(rebased)) {
    // Capture conflicts before aborting, then restore a clean, reusable tree.
    const conflictedFiles = await git.conflictedFiles(repo).catch(() => []);
    await git.rebaseAbort(repo).catch(() => undefined);
    return stepResult({
      step: "rebase",
      status: "findings",
      findings: [
        finding({
          id: "rebase.conflict",
          severity: "error",
          action: "ask-user",
          message:
            `Rebase onto '${base}' hit conflicts in ${conflictedFiles.length} file(s); manual resolution required.`,
          data: { conflictedFiles },
        }),
      ],
      data: { base, runBranch, commitsAhead: null, skipRemaining: false },
      evidence: { remote, aborted: true, rebaseExitCode: rebased.exitCode },
    });
  }

  const rebasedOnto = await git.revParse(repo, upstream);
  const commitsAhead = await git.revListCount(repo, `${upstream}..${runBranch}`);

  if (commitsAhead === 0) {
    return stepResult({
      step: "rebase",
      status: "skipped",
      findings: [
        finding({
          id: "rebase.no-diff",
          severity: "info",
          action: "no-op",
          message: `Run branch has no commits vs base '${base}' after rebase; skipping remaining pipeline.`,
          data: { base },
        }),
      ],
      data: { base, runBranch, commitsAhead: 0, skipRemaining: true, skipReason: "no-diff-vs-base" },
      evidence: { remote, rebasedOnto },
    });
  }

  const diffStat = await git.diffStat(repo, `${upstream}..${runBranch}`);
  return stepResult({
    step: "rebase",
    status: "passed",
    data: { base, runBranch, commitsAhead, skipRemaining: false },
    evidence: { remote, rebasedOnto, diffStat },
  });
}
