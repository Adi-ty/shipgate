import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as git from "../../src/core/git.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";

describe("git porcelain", () => {
  let fx: GitFixture;

  beforeEach(async () => {
    fx = await createFixture();
    // Build a small graph:
    //   main: init
    //   develop branched from main, + 2 commits
    //   release/v2 branched from main, + 1 commit
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await fx.emptyCommit("dev work a");
    await fx.emptyCommit("dev work b");

    await fx.branch("release/v2", "main");
    await fx.checkout("release/v2");
    await fx.emptyCommit("release work");

    await fx.checkout("main");
    await fx.pushAll();
  });

  afterEach(() => fx.cleanup());

  it("showToplevel returns the repo root", async () => {
    const top = await git.showToplevel(fx.repo);
    // macOS may resolve symlinks; compare by basename suffix.
    expect(top.endsWith("repo")).toBe(true);
  });

  it("revParse resolves HEAD to a 40-char sha", async () => {
    const sha = await git.revParse(fx.repo, "HEAD");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("listRemoteBranches returns pushed branches without remote prefix or HEAD", async () => {
    const branches = await git.listRemoteBranches(fx.repo, "origin");
    expect(branches.sort()).toEqual(["develop", "main", "release/v2"]);
    expect(branches).not.toContain("HEAD");
    expect(branches.every((b) => !b.startsWith("origin/"))).toBe(true);
  });

  it("remoteBranchExists distinguishes present vs absent", async () => {
    expect(await git.remoteBranchExists(fx.repo, "origin", "develop")).toBe(true);
    expect(await git.remoteBranchExists(fx.repo, "origin", "release/v2")).toBe(true);
    expect(await git.remoteBranchExists(fx.repo, "origin", "nope")).toBe(false);
  });

  it("mergeBase returns a sha for related history and null for unrelated", async () => {
    const mb = await git.mergeBase(fx.repo, "origin/develop", "origin/release/v2");
    expect(mb).toMatch(/^[0-9a-f]{40}$/);

    // Orphan branch shares no history with main.
    await fx.git(["checkout", "--orphan", "orphan"]);
    await fx.git(["commit", "--allow-empty", "-m", "orphan root"]);
    const none = await git.mergeBase(fx.repo, "main", "orphan");
    expect(none).toBeNull();
  });

  it("isAncestor reflects the commit graph", async () => {
    expect(await git.isAncestor(fx.repo, "origin/main", "origin/develop")).toBe(true);
    expect(await git.isAncestor(fx.repo, "origin/develop", "origin/main")).toBe(false);
  });

  it("revListCount counts commits in a range", async () => {
    const mb = (await git.mergeBase(fx.repo, "origin/main", "origin/develop"))!;
    const count = await git.revListCount(fx.repo, `${mb}..origin/develop`);
    expect(count).toBe(2);
  });

  it("diffStat parses insertions/deletions/files over a range", async () => {
    await fx.checkout("main");
    await fx.branch("feature", "main");
    await fx.checkout("feature");
    fx.write("a.txt", "line1\nline2\n");
    await fx.commitAll("add a.txt");
    const stat = await git.diffStat(fx.repo, "main..feature");
    expect(stat.files).toBe(1);
    expect(stat.insertions).toBe(2);
    expect(stat.deletions).toBe(0);
  });

  it("statusPorcelain reflects a dirty working tree", async () => {
    expect(await git.statusPorcelain(fx.repo)).toBe("");
    fx.write("dirty.txt", "x");
    expect(await git.statusPorcelain(fx.repo)).toContain("dirty.txt");
  });

  it("fetch succeeds against the origin remote", async () => {
    const r = await git.fetch(fx.repo, "origin");
    expect(r.exitCode).toBe(0);
  });
});
