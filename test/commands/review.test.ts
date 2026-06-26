import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as review from "../../src/commands/review.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";

const RUN = "shipgate/run-testrun01";

describe("review command", () => {
  let fx: GitFixture;
  beforeEach(async () => {
    fx = await createFixture();
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    fx.write("base.txt", "base\n");
    await fx.commitAll("develop base");
    await fx.push("develop");
    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
  });
  afterEach(() => fx.cleanup());

  it("packages the diff and always carries the human gate", async () => {
    fx.write("base.txt", "changed\n");
    fx.write("new.ts", "export const x = 1\n");
    await fx.commitAll("run change");

    const r = await review.run({ repo: fx.repo, runBranch: RUN, base: "develop" });
    expect(r.status).toBe("findings");
    expect(r.findings.some((f) => f.id === "review.gate" && f.action === "ask-user")).toBe(true);
    expect(r.data).toMatchObject({ base: "develop", baseRef: "origin/develop", filesChanged: 2 });
    expect((r.data as { changedFiles: string[] }).changedFiles.sort()).toEqual(["base.txt", "new.ts"]);
    expect((r.evidence as { diff: string }).diff).toContain("changed");
    expect((r.evidence as { diffStat: { files: number } }).diffStat.files).toBe(2);
  });

  it("skips when there is nothing to review", async () => {
    const r = await review.run({ repo: fx.repo, runBranch: RUN, base: "develop" });
    expect(r.status).toBe("skipped");
    expect(r.findings[0]?.id).toBe("review.no-changes");
  });

  it("merges agent findings from --findings-file", async () => {
    fx.write("f.txt", "x\n");
    await fx.commitAll("c");
    const ff = join(fx.repo, "findings.json");
    writeFileSync(ff, JSON.stringify([{ id: "bug.1", severity: "error", action: "auto-fix", message: "possible leak" }]));

    const r = await review.run({ repo: fx.repo, runBranch: RUN, base: "develop", findingsFile: ff });
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("bug.1");
    expect(ids).toContain("review.gate");
    expect((r.evidence as { agentFindings: number }).agentFindings).toBe(1);
  });

  it("fails when the base cannot be found", async () => {
    fx.write("f.txt", "x\n");
    await fx.commitAll("c");
    const r = await review.run({ repo: fx.repo, runBranch: RUN, base: "ghost" });
    expect(r.status).toBe("failed");
    expect(r.findings[0]?.id).toBe("review.base-not-found");
  });
});
