import type { ExecResult } from "../core/exec.js";

/** Summary of a `git diff --numstat` over a commit range. */
export interface DiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

/**
 * The git surface the pipeline depends on. Steps depend on this interface, not
 * on the concrete module, so tests can substitute a fake — though in practice we
 * run the real implementation against throwaway repos and only mock the network
 * (gh) layer. Every method takes the repo working directory as its first arg, so
 * a single shared port instance works across repos and worktrees.
 */
export interface GitPort {
  /** Absolute path of the repo root (`git rev-parse --show-toplevel`). */
  showToplevel(cwd: string): Promise<string>;
  /** Resolve a ref to its full sha; throws if the ref does not resolve. */
  revParse(cwd: string, ref: string): Promise<string>;
  /** True iff `refs/remotes/<remote>/<branch>` exists. */
  remoteBranchExists(cwd: string, remote: string, branch: string): Promise<boolean>;
  /** Short branch names under `refs/remotes/<remote>/` (remote prefix stripped, HEAD excluded). */
  listRemoteBranches(cwd: string, remote: string): Promise<string[]>;
  /** Best common ancestor sha of two refs, or null if histories are unrelated. */
  mergeBase(cwd: string, a: string, b: string): Promise<string | null>;
  /** True iff `ancestor` is an ancestor of `descendant`. Throws on a real git error. */
  isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean>;
  /** Number of commits in a revision range (e.g. "A..B"). */
  revListCount(cwd: string, range: string): Promise<number>;
  fetch(cwd: string, remote: string, ref?: string): Promise<ExecResult>;
  /** `git push [--force|--force-with-lease] <target> <refspec>`. target may be a remote name or URL. */
  push(cwd: string, target: string, refspec: string, opts?: { force?: boolean; forceWithLease?: boolean }): Promise<ExecResult>;
  /** `git rebase <upstream> [branch]` — passing branch checks it out first. */
  rebase(cwd: string, upstream: string, branch?: string): Promise<ExecResult>;
  rebaseAbort(cwd: string): Promise<ExecResult>;
  /** Unmerged paths (`--diff-filter=U`), e.g. during a rebase conflict. */
  conflictedFiles(cwd: string): Promise<string[]>;
  diffStat(cwd: string, range: string): Promise<DiffStat>;
  /** `git worktree add --detach <dir> <commitish>`. */
  worktreeAdd(cwd: string, dir: string, commitish: string): Promise<ExecResult>;
  /** `git worktree remove --force <dir>`. */
  worktreeRemove(cwd: string, dir: string): Promise<ExecResult>;
  worktreePrune(cwd: string): Promise<ExecResult>;
  /** `git branch -f <name> <commitish>` (force keeps run-branch creation idempotent). */
  branchCreate(cwd: string, name: string, commitish: string): Promise<ExecResult>;
  statusPorcelain(cwd: string): Promise<string>;
}
