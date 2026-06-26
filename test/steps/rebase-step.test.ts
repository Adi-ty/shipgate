import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { realGit } from "../../src/core/git.js";
import { rebaseStep } from "../../src/steps/rebase-step.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";

const RUN = "shipgate/run-testrun01";

describe("rebaseStep", () => {
  let fx: GitFixture;
  beforeEach(async () => {
    fx = await createFixture();
  });
  afterEach(() => fx.cleanup());

  it("clean rebase with commits ahead → passed", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    fx.write("base.txt", "base\n");
    await fx.commitAll("develop base file");
    await fx.push("develop");

    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    for (const f of ["r0.txt", "r1.txt", "r2.txt"]) {
      fx.write(f, "x\n");
      await fx.commitAll(`run ${f}`);
    }

    const result = await rebaseStep({ repo: fx.repo, runBranch: RUN, base: "develop", git: realGit });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ base: "develop", commitsAhead: 3, skipRemaining: false });
    expect((result.evidence as { diffStat: { files: number } }).diffStat.files).toBe(3);
  });

  it("empty branch after rebase → skipped with skipRemaining signal", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await fx.emptyCommit("develop work");
    await fx.push("develop");

    // Run branch with no commits of its own.
    await fx.branch(RUN, "develop");

    const result = await rebaseStep({ repo: fx.repo, runBranch: RUN, base: "develop", git: realGit });

    expect(result.status).toBe("skipped");
    expect(result.data).toMatchObject({
      commitsAhead: 0,
      skipRemaining: true,
      skipReason: "no-diff-vs-base",
    });
    expect(result.findings[0]).toMatchObject({ id: "rebase.no-diff", action: "no-op", severity: "info" });
  });

  it("conflicting rebase → aborts and asks the user, leaving a clean tree", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    fx.write("foo.txt", "base\n");
    await fx.commitAll("base foo");
    await fx.push("develop");

    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    fx.write("foo.txt", "run change\n");
    await fx.commitAll("run edits foo");

    // Advance origin/develop with a conflicting change on the same line.
    await fx.checkout("develop");
    fx.write("foo.txt", "develop change\n");
    await fx.commitAll("develop edits foo");
    await fx.push("develop");

    const result = await rebaseStep({ repo: fx.repo, runBranch: RUN, base: "develop", git: realGit });

    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "rebase.conflict", action: "ask-user", severity: "error" });
    expect((result.findings[0]!.data as { conflictedFiles: string[] }).conflictedFiles).toContain("foo.txt");
    expect(result.evidence).toMatchObject({ aborted: true });

    // Tree is clean and no rebase is in progress.
    expect(await realGit.statusPorcelain(fx.repo)).toBe("");
  });

  it("base advanced with non-conflicting changes → clean replay, commits preserved", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    fx.write("base.txt", "base\n");
    await fx.commitAll("develop base");
    await fx.push("develop");

    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    fx.write("bar.txt", "bar\n");
    await fx.commitAll("run adds bar");
    fx.write("qux.txt", "qux\n");
    await fx.commitAll("run adds qux");

    // Advance develop with a non-conflicting file.
    await fx.checkout("develop");
    fx.write("baz.txt", "baz\n");
    await fx.commitAll("develop adds baz");
    await fx.push("develop");

    const result = await rebaseStep({ repo: fx.repo, runBranch: RUN, base: "develop", git: realGit });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ commitsAhead: 2, skipRemaining: false });
    // The advanced base is now an ancestor of the rebased run branch.
    expect(await realGit.isAncestor(fx.repo, "origin/develop", RUN)).toBe(true);
  });
});
