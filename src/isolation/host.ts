import { existsSync } from "node:fs";
import { ok, type ExecResult } from "../core/exec.js";
import type { GitPort } from "../ports/git.js";
import {
  type IsolationContext,
  type IsolationProvider,
  type Workspace,
  type WorkspaceRemoval,
  runBranchName,
  worktreePath,
} from "./provider.js";

async function expectOk(p: Promise<ExecResult>, what: string): Promise<ExecResult> {
  const r = await p;
  if (!ok(r)) {
    throw new Error(`${what} failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
  }
  return r;
}

/**
 * Host-based isolation: a disposable detached git worktree on a run-scoped branch.
 * Create makes the run branch at the current HEAD and adds a `--detach` worktree
 * at the same commit; remove tears it down and prunes admin state idempotently.
 */
export class HostIsolationProvider implements IsolationProvider {
  constructor(private readonly git: GitPort) {}

  async create(ctx: IsolationContext): Promise<Workspace> {
    const branch = runBranchName(ctx.runId);
    const dir = worktreePath(ctx.repoRoot, ctx.runId);
    const head = await this.git.revParse(ctx.repoRoot, "HEAD");

    // Run-scoped branch ref at the starting commit (force keeps create idempotent).
    await expectOk(this.git.branchCreate(ctx.repoRoot, branch, "HEAD"), "create run branch");
    // Disposable detached worktree at the same commit.
    await expectOk(this.git.worktreeAdd(ctx.repoRoot, dir, "HEAD"), "add worktree");

    return { repoRoot: ctx.repoRoot, path: dir, branch, runId: ctx.runId, detached: true, head };
  }

  async remove(ws: Workspace): Promise<WorkspaceRemoval> {
    const present = existsSync(ws.path);
    if (present) {
      await expectOk(this.git.worktreeRemove(ws.repoRoot, ws.path), "remove worktree");
    }
    // Always prune stale admin entries (e.g. from a crashed run), even if absent.
    await this.git.worktreePrune(ws.repoRoot);
    return { removed: present, alreadyAbsent: !present };
  }
}
