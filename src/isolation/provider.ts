import { join } from "node:path";

/**
 * The isolation boundary the pipeline runs inside. v1 ships a host-based
 * provider (a git worktree on the host); a container / wp-env-per-run provider
 * can be added later behind this same interface without touching the pipeline.
 */

export interface IsolationContext {
  repoRoot: string;
  /**
   * Injected, never generated inside the provider — this is what keeps run-branch
   * and worktree naming collision-safe yet fully deterministic under test.
   */
  runId: string;
}

export interface Workspace {
  repoRoot: string;
  /** Absolute path to the isolated checkout. */
  path: string;
  /** The run-scoped branch ref pointing at the run's starting commit. */
  branch: string;
  runId: string;
  detached: true;
  /** Sha the workspace was created at. */
  head: string;
}

export interface WorkspaceRemoval {
  /** True if an existing worktree was actually removed. */
  removed: boolean;
  /** True if the worktree was already gone (idempotent remove). */
  alreadyAbsent: boolean;
}

export interface IsolationProvider {
  create(ctx: IsolationContext): Promise<Workspace>;
  remove(ws: Workspace): Promise<WorkspaceRemoval>;
}

/** The run-scoped branch name for a run id. */
export function runBranchName(runId: string): string {
  return `shipgate/run-${runId}`;
}

/**
 * Worktree checkout path for a run id. Placed inside `.git` so it is auto-ignored
 * by the main worktree and cleaned by `git worktree prune`.
 */
export function worktreePath(repoRoot: string, runId: string): string {
  return join(repoRoot, ".git", "shipgate", "worktrees", runId);
}
