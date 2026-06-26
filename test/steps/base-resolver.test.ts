import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { realGit } from "../../src/core/git.js";
import { resolveBase } from "../../src/steps/base-resolver.js";
import { DEFAULT_CONFIG, type ShipgateConfig } from "../../src/core/config.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";
import { fakeGh } from "../helpers/fake-gh.js";

const RUN = "shipgate/run-testrun01";

function config(overrides: Partial<ShipgateConfig["base"]> = {}): ShipgateConfig {
  return { ...DEFAULT_CONFIG, base: { ...DEFAULT_CONFIG.base, ...overrides }, source: "default" };
}

/** Add `n` empty commits on the currently checked-out branch. */
async function commits(fx: GitFixture, n: number, label: string) {
  for (let i = 0; i < n; i++) await fx.emptyCommit(`${label} ${i}`);
}

describe("resolveBase", () => {
  let fx: GitFixture;
  beforeEach(async () => {
    fx = await createFixture();
  });
  afterEach(() => fx.cleanup());

  it("1. open PR wins over what git would pick", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await commits(fx, 1, "dev");
    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    await commits(fx, 1, "run");
    await fx.push("main");
    await fx.push("develop");

    const gh = fakeGh({ [RUN]: "release/v2" });
    const result = await resolveBase({ repo: fx.repo, runBranch: RUN, config: config(), git: realGit, gh });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ rule: "open-pr", resolvedBase: "release/v2", runBranch: RUN });
    expect(gh.calls).toEqual([RUN]);
    expect(result.evidence).toMatchObject({ ghPrBaseRefName: "release/v2" });
  });

  it("2. valid --base override resolves via override-flag", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await commits(fx, 1, "dev");
    await fx.branch(RUN, "develop");
    await fx.push("main");
    await fx.push("develop");

    const gh = fakeGh();
    const result = await resolveBase({
      repo: fx.repo,
      runBranch: RUN,
      override: "develop",
      config: config(),
      git: realGit,
      gh,
    });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ rule: "override-flag", resolvedBase: "develop" });
    expect(result.evidence).toMatchObject({ overrideFlag: "develop" });
  });

  it("3. config glob rule resolves feature/v2-* → release/v2", async () => {
    await fx.branch("release/v2", "main");
    await fx.checkout("release/v2");
    await commits(fx, 1, "rel");
    await fx.checkout("main");
    await fx.branch("feature/v2-search", "main");
    await fx.push("main");
    await fx.push("release/v2");

    const gh = fakeGh();
    const result = await resolveBase({
      repo: fx.repo,
      runBranch: "feature/v2-search",
      config: config({ rules: [{ when: "feature/v2-*", use: "release/v2" }] }),
      git: realGit,
      gh,
    });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({
      rule: "override-config-glob",
      resolvedBase: "release/v2",
      matchedRule: { when: "feature/v2-*", use: "release/v2" },
    });
  });

  it("4. override pointing at a nonexistent branch → ask-user", async () => {
    await fx.branch(RUN, "main");
    await fx.push("main");

    const gh = fakeGh();
    const result = await resolveBase({
      repo: fx.repo,
      runBranch: RUN,
      override: "no-such-branch",
      config: config(),
      git: realGit,
      gh,
    });

    expect(result.status).toBe("findings");
    expect(result.data).toMatchObject({ rule: "override-flag", resolvedBase: null });
    expect(result.findings[0]).toMatchObject({ id: "base.override-missing", action: "ask-user", severity: "error" });
  });

  it("5. nearest divergence picks the branch with the smaller commit distance", async () => {
    // develop is 8 ahead of main; run is 3 ahead of develop.
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await commits(fx, 8, "dev");
    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    await commits(fx, 3, "run");
    await fx.push("main");
    await fx.push("develop");

    const gh = fakeGh();
    const result = await resolveBase({ repo: fx.repo, runBranch: RUN, config: config(), git: realGit, gh });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ rule: "nearest-divergence", resolvedBase: "develop" });
    const cands = (result.evidence as { candidates: Array<{ branch: string; distance: number; chosen: boolean }> }).candidates;
    expect(cands.find((c) => c.branch === "develop")).toMatchObject({ distance: 3, chosen: true });
    expect(cands.find((c) => c.branch === "main")).toMatchObject({ distance: 11, chosen: false });
  });

  it("6. equal distance, mutually independent → ambiguous ask-user (resolvedBase null)", async () => {
    // main(c0) → stage P (+3) → develop(+2), release/v2(+2), run(+5), all siblings off P.
    await fx.branch("stage", "main");
    await fx.checkout("stage");
    await commits(fx, 3, "p");
    await fx.branch("develop", "stage");
    await fx.branch("release/v2", "stage");
    await fx.branch(RUN, "stage");
    await fx.checkout("develop");
    await commits(fx, 2, "dev");
    await fx.checkout("release/v2");
    await commits(fx, 2, "rel");
    await fx.checkout(RUN);
    await commits(fx, 5, "run");
    await fx.push("main");
    await fx.push("develop");
    await fx.push("release/v2");

    const gh = fakeGh();
    const result = await resolveBase({ repo: fx.repo, runBranch: RUN, config: config(), git: realGit, gh });

    expect(result.status).toBe("findings");
    expect(result.data).toMatchObject({ rule: "ambiguous", resolvedBase: null });
    expect(result.findings[0]).toMatchObject({ id: "base.ambiguous", action: "ask-user" });
    expect((result.findings[0]!.data as { candidates: string[] }).candidates).toEqual(["develop", "release/v2"]);
  });

  it("7. equal distance but develop ⊂ release/v2 → pick the descendant (not a tie)", async () => {
    // main → develop (+3 = P) → release/v2 (+2). run branches from develop tip P (+2).
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await commits(fx, 3, "dev"); // P = develop tip
    await fx.branch("release/v2", "develop");
    await fx.branch(RUN, "develop");
    await fx.checkout("release/v2");
    await commits(fx, 2, "rel");
    await fx.checkout(RUN);
    await commits(fx, 2, "run");
    await fx.push("main");
    await fx.push("develop");
    await fx.push("release/v2");

    const gh = fakeGh();
    const result = await resolveBase({ repo: fx.repo, runBranch: RUN, config: config(), git: realGit, gh });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ rule: "nearest-divergence", resolvedBase: "release/v2" });
    const cands = (result.evidence as { candidates: Array<{ branch: string; distance: number; chosen: boolean }> }).candidates;
    expect(cands.find((c) => c.branch === "develop")!.distance).toBe(cands.find((c) => c.branch === "release/v2")!.distance);
  });

  it("8. weak intent hint is recorded but never breaks a true tie", async () => {
    await fx.branch("stage", "main");
    await fx.checkout("stage");
    await commits(fx, 3, "p");
    await fx.branch("develop", "stage");
    await fx.branch("release/v2", "stage");
    await fx.branch(RUN, "stage");
    await fx.checkout("develop");
    await commits(fx, 2, "dev");
    await fx.checkout("release/v2");
    await commits(fx, 2, "rel");
    await fx.checkout(RUN);
    await commits(fx, 5, "run");
    await fx.push("main");
    await fx.push("develop");
    await fx.push("release/v2");

    const gh = fakeGh();
    const result = await resolveBase({
      repo: fx.repo,
      runBranch: RUN,
      intentText: "v2",
      config: config(),
      git: realGit,
      gh,
    });

    expect(result.status).toBe("findings");
    expect(result.data).toMatchObject({ rule: "ambiguous", resolvedBase: null });
    expect(result.evidence).toMatchObject({ intentHint: "v2" });
  });

  it("9. unrelated-history candidate is skipped, not crashed", async () => {
    await fx.branch("develop", "main");
    await fx.checkout("develop");
    await commits(fx, 2, "dev");
    await fx.branch(RUN, "develop");
    await fx.checkout(RUN);
    await commits(fx, 1, "run");
    // master as an orphan: shares no history with run.
    await fx.git(["checkout", "--orphan", "master"]);
    await fx.git(["commit", "--allow-empty", "-m", "orphan root"]);
    await fx.push("main");
    await fx.push("develop");
    await fx.push("master");

    const gh = fakeGh();
    const result = await resolveBase({ repo: fx.repo, runBranch: RUN, config: config(), git: realGit, gh });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ rule: "nearest-divergence", resolvedBase: "develop" });
    const cands = (result.evidence as { candidates: Array<{ branch: string }> }).candidates;
    expect(cands.map((c) => c.branch).sort()).toEqual(["develop", "main"]); // master skipped
  });
});
