import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as push from "../../src/commands/push.js";
import { realGit } from "../../src/core/git.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";

const RUN = "shipgate/run-testrun01";

describe("push command", () => {
  let fx: GitFixture;
  beforeEach(async () => {
    fx = await createFixture();
    await fx.branch(RUN, "main");
    await fx.checkout(RUN);
    fx.write("feature.txt", "work\n");
    await fx.commitAll("run work");
  });
  afterEach(() => fx.cleanup());

  it("pushes the run branch to origin with --force-with-lease", async () => {
    const result = await push.run({ repo: fx.repo, runBranch: RUN });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ branch: RUN, target: "origin", forceWithLease: true });
    expect(await realGit.remoteBranchExists(fx.repo, "origin", RUN)).toBe(true);
  });

  it("re-pushes after a rebase/amend (force-with-lease succeeds)", async () => {
    await push.run({ repo: fx.repo, runBranch: RUN });
    await fx.git(["commit", "--amend", "-m", "run work (amended)"]);
    const result = await push.run({ repo: fx.repo, runBranch: RUN });
    expect(result.status).toBe("passed");
  });

  it("pushes to an explicit URL (fork) with --force", async () => {
    const result = await push.run({ repo: fx.repo, runBranch: RUN, url: fx.origin });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ target: fx.origin, forced: true });
    const ls = await fx.git(["ls-remote", fx.origin, RUN]);
    expect(ls).toContain(RUN);
  });

  it("fails cleanly when the target remote does not exist", async () => {
    const result = await push.run({ repo: fx.repo, runBranch: RUN, remote: "nope" });
    expect(result.status).toBe("failed");
    expect(result.findings[0]).toMatchObject({ id: "push.failed", action: "ask-user" });
  });
});
