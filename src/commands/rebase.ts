import { realGit, currentBranch } from "../core/git.js";
import { rebaseStep } from "../steps/rebase-step.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import type { GitPort } from "../ports/git.js";

export interface RebaseOptions {
  base: string;
  runBranch?: string;
  remote?: string;
  repo?: string;
}

export interface RebaseDeps {
  git?: GitPort;
}

/** `shipgate rebase` — rebase the run branch onto the resolved base. */
export async function run(opts: RebaseOptions, deps: RebaseDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const runBranch = opts.runBranch ?? (await currentBranch(repoRoot));

  if (!runBranch) {
    return stepResult({
      step: "rebase",
      status: "failed",
      findings: [
        finding({
          id: "rebase.no-run-branch",
          severity: "error",
          action: "ask-user",
          message: "Could not determine the run branch (detached HEAD); pass --run-branch.",
        }),
      ],
      data: { base: opts.base, runBranch: null, commitsAhead: null, skipRemaining: false },
    });
  }

  return rebaseStep({ repo: repoRoot, runBranch, base: opts.base, remote: opts.remote, git });
}
