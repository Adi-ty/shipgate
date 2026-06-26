import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { realGit } from "../../src/core/git.js";
import { HostIsolationProvider } from "../../src/isolation/host.js";
import { runBranchName, worktreePath } from "../../src/isolation/provider.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";

describe("HostIsolationProvider", () => {
  let fx: GitFixture;
  let provider: HostIsolationProvider;

  beforeEach(async () => {
    fx = await createFixture();
    provider = new HostIsolationProvider(realGit);
  });
  afterEach(() => fx.cleanup());

  it("creates a detached worktree on the run-scoped branch at HEAD", async () => {
    const head = await fx.sha("HEAD");
    const ws = await provider.create({ repoRoot: fx.repo, runId: fx.runId });

    expect(ws.branch).toBe(runBranchName(fx.runId));
    expect(ws.branch).toBe("shipgate/run-testrun01");
    expect(ws.path).toBe(worktreePath(fx.repo, fx.runId));
    expect(ws.path).toContain(join(".git", "shipgate", "worktrees", "testrun01"));
    expect(ws.detached).toBe(true);
    expect(ws.head).toBe(head);

    // Worktree checkout exists on disk.
    expect(existsSync(ws.path)).toBe(true);

    // HEAD in the worktree is detached.
    expect(await fx.git(["rev-parse", "--abbrev-ref", "HEAD"], ws.path)).toBe("HEAD");

    // Run branch ref exists and points at the starting commit.
    expect(await fx.sha(ws.branch)).toBe(head);

    // git knows about the linked worktree.
    const list = await fx.git(["worktree", "list"]);
    expect(list).toContain(ws.path);
  });

  it("removes the worktree and prunes", async () => {
    const ws = await provider.create({ repoRoot: fx.repo, runId: fx.runId });
    expect(existsSync(ws.path)).toBe(true);

    const result = await provider.remove(ws);
    expect(result).toEqual({ removed: true, alreadyAbsent: false });
    expect(existsSync(ws.path)).toBe(false);

    const list = await fx.git(["worktree", "list"]);
    expect(list).not.toContain(ws.path);
  });

  it("remove is idempotent when the worktree is already gone", async () => {
    const ws = await provider.create({ repoRoot: fx.repo, runId: fx.runId });
    await provider.remove(ws);

    const again = await provider.remove(ws);
    expect(again).toEqual({ removed: false, alreadyAbsent: true });
  });

  it("create is idempotent on the run branch (force)", async () => {
    const ws1 = await provider.create({ repoRoot: fx.repo, runId: fx.runId });
    await provider.remove(ws1);
    // Re-creating with the same runId must not fail on an existing branch ref.
    const ws2 = await provider.create({ repoRoot: fx.repo, runId: fx.runId });
    expect(ws2.branch).toBe(ws1.branch);
    expect(existsSync(ws2.path)).toBe(true);
  });
});
