import { exec, ok, type ExecResult } from "./exec.js";
import type { DiffStat, GitPort } from "../ports/git.js";

/**
 * Thin, typed git porcelain over `exec`. Plumbing only — no policy lives here.
 * Read wrappers parse output into typed values; mutating wrappers return the raw
 * ExecResult so callers (the steps) decide what a non-zero exit means.
 */

function git(cwd: string, args: string[]): Promise<ExecResult> {
  return exec("git", args, { cwd });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (!ok(r)) {
    throw new Error(`git ${args.join(" ")} failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout.trim();
}

export function showToplevel(cwd: string): Promise<string> {
  return gitText(cwd, ["rev-parse", "--show-toplevel"]);
}

export function revParse(cwd: string, ref: string): Promise<string> {
  return gitText(cwd, ["rev-parse", ref]);
}

export async function remoteBranchExists(cwd: string, remote: string, branch: string): Promise<boolean> {
  const r = await git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`]);
  return ok(r);
}

export async function listRemoteBranches(cwd: string, remote: string): Promise<string[]> {
  const out = await gitText(cwd, ["for-each-ref", "--format=%(refname:short)", `refs/remotes/${remote}`]);
  if (!out) return [];
  const prefix = `${remote}/`;
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => l !== remote && l !== `${remote}/HEAD` && !l.endsWith("/HEAD"))
    .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l));
}

export async function mergeBase(cwd: string, a: string, b: string): Promise<string | null> {
  const r = await git(cwd, ["merge-base", a, b]);
  return ok(r) ? r.stdout.trim() : null;
}

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  const r = await git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (r.exitCode === 0) return true;
  if (r.exitCode === 1) return false;
  throw new Error(`git merge-base --is-ancestor failed (exit ${r.exitCode}): ${r.stderr.trim()}`);
}

export async function revListCount(cwd: string, range: string): Promise<number> {
  const out = await gitText(cwd, ["rev-list", "--count", range]);
  return Number.parseInt(out, 10);
}

export function fetch(cwd: string, remote: string, ref?: string): Promise<ExecResult> {
  return git(cwd, ref ? ["fetch", remote, ref] : ["fetch", remote]);
}

export function push(
  cwd: string,
  target: string,
  refspec: string,
  opts: { force?: boolean; forceWithLease?: boolean } = {},
): Promise<ExecResult> {
  const args = ["push"];
  if (opts.forceWithLease) args.push("--force-with-lease");
  else if (opts.force) args.push("--force");
  args.push(target, refspec);
  return git(cwd, args);
}

export function rebase(cwd: string, upstream: string, branch?: string): Promise<ExecResult> {
  return git(cwd, branch ? ["rebase", upstream, branch] : ["rebase", upstream]);
}

export function rebaseAbort(cwd: string): Promise<ExecResult> {
  return git(cwd, ["rebase", "--abort"]);
}

export async function conflictedFiles(cwd: string): Promise<string[]> {
  const out = await gitText(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

export async function diffStat(cwd: string, range: string): Promise<DiffStat> {
  const out = await gitText(cwd, ["diff", "--numstat", range]);
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    files += 1;
    const [ins, del] = line.split("\t");
    // Binary files report "-"; treat as 0.
    if (ins && ins !== "-") insertions += Number.parseInt(ins, 10) || 0;
    if (del && del !== "-") deletions += Number.parseInt(del, 10) || 0;
  }
  return { files, insertions, deletions };
}

export function worktreeAdd(cwd: string, dir: string, commitish: string): Promise<ExecResult> {
  return git(cwd, ["worktree", "add", "--detach", dir, commitish]);
}

export function worktreeRemove(cwd: string, dir: string): Promise<ExecResult> {
  return git(cwd, ["worktree", "remove", "--force", dir]);
}

export function worktreePrune(cwd: string): Promise<ExecResult> {
  return git(cwd, ["worktree", "prune"]);
}

export function branchCreate(cwd: string, name: string, commitish: string): Promise<ExecResult> {
  return git(cwd, ["branch", "-f", name, commitish]);
}

export function statusPorcelain(cwd: string): Promise<string> {
  return gitText(cwd, ["status", "--porcelain"]);
}

/** Current branch name, or null when HEAD is detached. Not part of GitPort (used only by the CLI layer). */
export async function currentBranch(cwd: string): Promise<string | null> {
  const r = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!ok(r)) return null;
  const name = r.stdout.trim();
  return name && name !== "HEAD" ? name : null;
}

/** Concrete GitPort backed by the real `git` binary. */
export const realGit: GitPort = {
  showToplevel,
  revParse,
  remoteBranchExists,
  listRemoteBranches,
  mergeBase,
  isAncestor,
  revListCount,
  fetch,
  push,
  rebase,
  rebaseAbort,
  conflictedFiles,
  diffStat,
  worktreeAdd,
  worktreeRemove,
  worktreePrune,
  branchCreate,
  statusPorcelain,
};
