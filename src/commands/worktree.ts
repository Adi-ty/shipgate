import { realGit } from "../core/git.js";
import { stepResult, type StepResult } from "../core/findings.js";
import { HostIsolationProvider } from "../isolation/host.js";
import { runBranchName, worktreePath, type IsolationProvider, type Workspace } from "../isolation/provider.js";
import type { GitPort } from "../ports/git.js";

export interface WorktreeOptions {
  runId: string;
  repo?: string;
}

export interface WorktreeDeps {
  git?: GitPort;
  provider?: IsolationProvider;
}

function resolveProvider(deps: WorktreeDeps): IsolationProvider {
  return deps.provider ?? new HostIsolationProvider(deps.git ?? realGit);
}

/** Create the disposable detached worktree on the run-scoped branch. */
export async function runCreate(opts: WorktreeOptions, deps: WorktreeDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const provider = resolveProvider(deps);
  const ws = await provider.create({ repoRoot, runId: opts.runId });
  return stepResult({
    step: "worktree.create",
    status: "passed",
    data: { runId: ws.runId, branch: ws.branch, path: ws.path, detached: true },
    evidence: { head: ws.head },
  });
}

/** Tear down the run worktree and prune; idempotent if already gone. */
export async function runRemove(opts: WorktreeOptions, deps: WorktreeDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const provider = resolveProvider(deps);
  const ws: Workspace = {
    repoRoot,
    path: worktreePath(repoRoot, opts.runId),
    branch: runBranchName(opts.runId),
    runId: opts.runId,
    detached: true,
    head: "",
  };
  const removal = await provider.remove(ws);
  return stepResult({
    step: "worktree.remove",
    status: "passed",
    data: { runId: opts.runId, removed: removal.removed },
    evidence: { pruned: true, alreadyAbsent: removal.alreadyAbsent },
  });
}
