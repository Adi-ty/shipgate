import { describe, it, expect } from "vitest";
import * as ciWatch from "../../src/commands/ci-watch.js";
import { fakeGh } from "../helpers/fake-gh.js";
import type { CiStatus, PullRequest } from "../../src/ports/gh.js";

const REPO = "/Users/demo/Projects/widget";
const OPEN_PR: Record<string, PullRequest> = {
  feature: { number: 7, url: "https://github.com/demo/repo/pull/7", state: "OPEN", baseRefName: "develop", headRefName: "feature" },
};

/** A fake monotonic clock whose `sleep` advances time — no real waiting. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

const pending: CiStatus = { state: "pending", mergeable: "UNKNOWN", checks: [{ name: "build", status: "IN_PROGRESS", conclusion: null }] };
const passing: CiStatus = { state: "passing", mergeable: "MERGEABLE", checks: [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }] };
const failing: CiStatus = { state: "failing", mergeable: "UNKNOWN", checks: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }] };

describe("ci-watch command", () => {
  it("polls until CI turns green", async () => {
    const gh = fakeGh({}, { prs: OPEN_PR, statuses: { feature: [pending, pending, passing] } });
    const { now, sleep } = clock();
    const result = await ciWatch.run({ repo: REPO, runBranch: "feature" }, { gh, now, sleep });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ state: "passing", mergeable: "MERGEABLE", number: 7 });
    expect((result.evidence as { polls: number }).polls).toBe(3);
  });

  it("reports failing CI as an ask-user finding", async () => {
    const gh = fakeGh({}, { prs: OPEN_PR, statuses: { feature: [pending, failing] } });
    const { now, sleep } = clock();
    const result = await ciWatch.run({ repo: REPO, runBranch: "feature" }, { gh, now, sleep });

    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "ci.failed", action: "ask-user" });
  });

  it("times out while CI stays pending", async () => {
    const gh = fakeGh({}, { prs: OPEN_PR, statuses: { feature: [pending] } });
    const { now, sleep } = clock();
    const result = await ciWatch.run({ repo: REPO, runBranch: "feature", timeoutS: 60, intervalS: 15 }, { gh, now, sleep });

    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "ci.timeout", action: "ask-user" });
    expect(result.data).toMatchObject({ state: "timeout" });
  });

  it("flags a green-but-unmergeable PR", async () => {
    const conflicting: CiStatus = { state: "passing", mergeable: "CONFLICTING", checks: [] };
    const gh = fakeGh({}, { prs: OPEN_PR, statuses: { feature: [conflicting] } });
    const { now, sleep } = clock();
    const result = await ciWatch.run({ repo: REPO, runBranch: "feature" }, { gh, now, sleep });

    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "ci.not-mergeable", action: "ask-user" });
  });

  it("skips when the PR has no checks configured", async () => {
    const gh = fakeGh({}, { prs: OPEN_PR }); // no statuses → prStatus returns state "none"
    const { now, sleep } = clock();
    const result = await ciWatch.run({ repo: REPO, runBranch: "feature" }, { gh, now, sleep });

    expect(result.status).toBe("skipped");
    expect(result.findings[0]).toMatchObject({ id: "ci.no-checks", action: "no-op" });
  });

  it("skips when there is no open PR to watch", async () => {
    const gh = fakeGh(); // no PRs
    const { now, sleep } = clock();
    const result = await ciWatch.run({ repo: REPO, runBranch: "feature" }, { gh, now, sleep });

    expect(result.status).toBe("skipped");
    expect(result.findings[0]).toMatchObject({ id: "ci.no-pr", action: "no-op" });
  });
});
