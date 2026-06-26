import { realGit, currentBranch } from "../core/git.js";
import { realGh } from "../ports/gh.js";
import { loadConfig } from "../core/config.js";
import { resolveBase } from "../steps/base-resolver.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import type { GitPort } from "../ports/git.js";
import type { GhPort } from "../ports/gh.js";

export interface BaseOptions {
  runBranch?: string;
  base?: string;
  remote?: string;
  intentHint?: string;
  repo?: string;
}

export interface BaseDeps {
  git?: GitPort;
  /** Only the network seam (gh) needs mocking in tests; git runs for real. */
  gh?: GhPort;
}

/** `shipgate base` — resolve the integration/base branch for the run branch. */
export async function run(opts: BaseOptions, deps: BaseDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const gh = deps.gh ?? realGh;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const runBranch = opts.runBranch ?? (await currentBranch(repoRoot));

  if (!runBranch) {
    return stepResult({
      step: "base",
      status: "failed",
      findings: [
        finding({
          id: "base.no-run-branch",
          severity: "error",
          action: "ask-user",
          message: "Could not determine the run branch (detached HEAD); pass --run-branch.",
        }),
      ],
      data: { rule: "error", resolvedBase: null },
    });
  }

  const config = await loadConfig({ cwd: repoRoot });
  return resolveBase({
    repo: repoRoot,
    runBranch,
    remote: opts.remote,
    override: opts.base,
    config,
    intentText: opts.intentHint,
    git,
    gh,
  });
}
