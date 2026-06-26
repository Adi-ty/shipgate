import { currentBranch } from "../core/git.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import { realGh, type GhPort } from "../ports/gh.js";

export interface CiWatchOptions {
  repo?: string;
  runBranch?: string;
  /** Poll interval in seconds (default 15). */
  intervalS?: number;
  /** Overall timeout in seconds (default 600). */
  timeoutS?: number;
}

export interface CiWatchDeps {
  gh?: GhPort;
  /** Injectable for tests so no real waiting/clock is needed. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

/**
 * `shipgate ci-watch` — poll CI + mergeability for the run branch's PR until it
 * is green, fails, or times out. Emits a terminal StepResult; `pending` keeps
 * polling. The sleep/clock are injectable so tests run instantly.
 */
export async function run(opts: CiWatchOptions, deps: CiWatchDeps = {}): Promise<StepResult> {
  const gh = deps.gh ?? realGh;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => Date.now());
  const repoRoot = opts.repo ?? process.cwd();
  const runBranch = opts.runBranch ?? (await currentBranch(repoRoot));

  if (!runBranch) {
    return stepResult({
      step: "ci-watch",
      status: "failed",
      findings: [finding({ id: "ci.no-run-branch", severity: "error", action: "ask-user", message: "Could not determine the run branch (detached HEAD); pass --run-branch." })],
      data: { branch: null },
    });
  }

  const intervalMs = (opts.intervalS ?? 15) * 1000;
  const timeoutMs = (opts.timeoutS ?? 600) * 1000;

  const pr = await gh.prView(repoRoot, runBranch);
  if (!pr) {
    return stepResult({
      step: "ci-watch",
      status: "skipped",
      findings: [finding({ id: "ci.no-pr", severity: "info", action: "no-op", message: `No open PR found for '${runBranch}' to watch.` })],
      data: { branch: runBranch, state: "no-pr" },
    });
  }

  const start = now();
  let polls = 0;

  while (polls < 100_000) {
    const status = await gh.prStatus(repoRoot, runBranch);
    polls += 1;
    const evidence = { polls, checks: status.checks, mergeable: status.mergeable };

    if (status.state === "failing") {
      return stepResult({
        step: "ci-watch",
        status: "findings",
        findings: [finding({ id: "ci.failed", severity: "error", action: "ask-user", message: "CI is failing. Fix the failing checks before merging." })],
        data: { branch: runBranch, state: "failing", number: pr.number, url: pr.url },
        evidence,
      });
    }

    if (status.state === "none") {
      return stepResult({
        step: "ci-watch",
        status: "skipped",
        findings: [finding({ id: "ci.no-checks", severity: "info", action: "no-op", message: "No CI checks are configured for this PR." })],
        data: { branch: runBranch, state: "none", number: pr.number, url: pr.url },
        evidence,
      });
    }

    if (status.state === "passing") {
      if (status.mergeable === "CONFLICTING") {
        return stepResult({
          step: "ci-watch",
          status: "findings",
          findings: [finding({ id: "ci.not-mergeable", severity: "error", action: "ask-user", message: "CI is green but the PR is not mergeable (conflicts). Rebase and re-push." })],
          data: { branch: runBranch, state: "passing", mergeable: status.mergeable, number: pr.number, url: pr.url },
          evidence,
        });
      }
      return stepResult({
        step: "ci-watch",
        status: "passed",
        data: { branch: runBranch, state: "passing", mergeable: status.mergeable, number: pr.number, url: pr.url },
        evidence,
      });
    }

    // pending
    if (now() - start >= timeoutMs) {
      return stepResult({
        step: "ci-watch",
        status: "findings",
        findings: [finding({ id: "ci.timeout", severity: "warning", action: "ask-user", message: `CI still pending after ${opts.timeoutS ?? 600}s; stopped watching.` })],
        data: { branch: runBranch, state: "timeout", number: pr.number, url: pr.url },
        evidence,
      });
    }
    await sleep(intervalMs);
  }

  return stepResult({
    step: "ci-watch",
    status: "failed",
    findings: [finding({ id: "ci.poll-limit", severity: "error", action: "ask-user", message: "Exceeded the ci-watch poll limit." })],
    data: { branch: runBranch, state: "poll-limit" },
  });
}
