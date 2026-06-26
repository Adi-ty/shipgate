import { ok } from "../core/exec.js";
import { realGit, currentBranch } from "../core/git.js";
import { loadConfig } from "../core/config.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import { tail } from "./shared.js";
import type { GitPort } from "../ports/git.js";

export interface PushOptions {
  repo?: string;
  runBranch?: string;
  /** Push to a named remote (default origin / config.push.remote). */
  remote?: string;
  /** Push to an explicit URL (e.g. a fork), overriding the remote. */
  url?: string;
}

export interface PushDeps {
  git?: GitPort;
}

/**
 * `shipgate push` — push the validated run branch to its target. A configured
 * fork URL (or `--url`) may differ from the PR-base repo. Pushes to a named
 * remote use `--force-with-lease` (safe re-push after rebase); URL pushes use
 * `--force` (no tracking ref to lease against).
 */
export async function run(opts: PushOptions, deps: PushDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const config = await loadConfig({ cwd: repoRoot });
  const runBranch = opts.runBranch ?? (await currentBranch(repoRoot));

  if (!runBranch) {
    return stepResult({
      step: "push",
      status: "failed",
      findings: [
        finding({
          id: "push.no-run-branch",
          severity: "error",
          action: "ask-user",
          message: "Could not determine the run branch (detached HEAD); pass --run-branch.",
        }),
      ],
      data: { branch: null },
    });
  }

  const url = opts.url ?? config.push.url;
  let target: string;
  let refspec: string;
  let pushOpts: { force?: boolean; forceWithLease?: boolean };

  if (url) {
    target = url;
    refspec = `${runBranch}:${runBranch}`;
    pushOpts = { force: true };
  } else {
    target = opts.remote ?? config.push.remote ?? "origin";
    refspec = runBranch;
    pushOpts = { forceWithLease: true };
  }

  const r = await git.push(repoRoot, target, refspec, pushOpts);
  const data = {
    branch: runBranch,
    target,
    refspec,
    forced: pushOpts.force ?? false,
    forceWithLease: pushOpts.forceWithLease ?? false,
  };

  if (!ok(r)) {
    return stepResult({
      step: "push",
      status: "failed",
      findings: [
        finding({
          id: "push.failed",
          severity: "error",
          action: "ask-user",
          message: `Push of '${runBranch}' to '${target}' failed (exit ${r.exitCode}).`,
          data: { exitCode: r.exitCode },
        }),
      ],
      data,
      evidence: { exitCode: r.exitCode, stderrTail: tail(r.stderr) },
    });
  }

  return stepResult({ step: "push", status: "passed", data, evidence: { stderrTail: tail(r.stderr) } });
}
