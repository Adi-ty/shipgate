import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import * as worktree from "../../src/commands/worktree.js";
import * as base from "../../src/commands/base.js";
import * as rebase from "../../src/commands/rebase.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";
import { fakeGh } from "../helpers/fake-gh.js";

const RUN = "shipgate/run-testrun01";

describe("command handlers", () => {
  let fx: GitFixture;
  beforeEach(async () => {
    fx = await createFixture();
  });
  afterEach(() => fx.cleanup());

  it("worktree create then remove", async () => {
    const created = await worktree.runCreate({ runId: fx.runId, repo: fx.repo });
    expect(created.step).toBe("worktree.create");
    expect(created.status).toBe("passed");
    expect(created.data).toMatchObject({ runId: fx.runId, branch: RUN, detached: true });
    const path = (created.data as { path: string }).path;
    expect(existsSync(path)).toBe(true);

    const removed = await worktree.runRemove({ runId: fx.runId, repo: fx.repo });
    expect(removed.status).toBe("passed");
    expect(removed.data).toMatchObject({ runId: fx.runId, removed: true });
    expect(existsSync(path)).toBe(false);
  });

  it("base handler resolves via nearest divergence (gh mocked)", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await fx.emptyCommit("dev");
    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    await fx.emptyCommit("run");
    await fx.push("main");
    await fx.push("develop");

    const result = await base.run({ runBranch: RUN, repo: fx.repo }, { gh: fakeGh() });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ rule: "nearest-divergence", resolvedBase: "develop" });
  });

  it("base handler honors an open PR via the gh seam", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await fx.emptyCommit("dev");
    await fx.branch(RUN, "develop");
    await fx.push("main");
    await fx.push("develop");

    const result = await base.run({ runBranch: RUN, repo: fx.repo }, { gh: fakeGh({ [RUN]: "release/v9" }) });
    expect(result.data).toMatchObject({ rule: "open-pr", resolvedBase: "release/v9" });
  });

  it("rebase handler runs the rebase step", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    fx.write("base.txt", "base\n");
    await fx.commitAll("develop base");
    await fx.push("develop");

    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    fx.write("r.txt", "r\n");
    await fx.commitAll("run work");

    const result = await rebase.run({ base: "develop", runBranch: RUN, repo: fx.repo });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ commitsAhead: 1, skipRemaining: false });
  });
});
