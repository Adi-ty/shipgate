import { describe, it, expect, afterEach } from "vitest";
import * as pr from "../../src/commands/pr.js";
import { ClaudeCodeAdapter } from "../../src/core/agents/claude-code.js";
import { fakeGh } from "../helpers/fake-gh.js";
import { createTranscriptFixture, SAMPLE_LINES, type TranscriptFixture } from "../helpers/transcript-fixture.js";
import type { PullRequest } from "../../src/ports/gh.js";

const REPO = "/Users/demo/Projects/widget";

describe("pr command", () => {
  let tf: TranscriptFixture;
  afterEach(() => tf?.cleanup());

  it("creates a PR when none exists (explicit title/body)", async () => {
    const gh = fakeGh();
    const result = await pr.run(
      { repo: REPO, runBranch: "feature", base: "develop", title: "Add feature", body: "Does the thing." },
      { gh },
    );
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ action: "created", base: "develop", head: "feature", title: "Add feature" });
    expect(gh.calls).toContain("create:feature->develop");
    expect(gh.prs.get("feature")?.baseRefName).toBe("develop");
  });

  it("builds title/body from session intent when not supplied", async () => {
    tf = createTranscriptFixture();
    tf.writeTranscript(REPO, "sess1", SAMPLE_LINES);
    const adapter = new ClaudeCodeAdapter({ projectsDir: tf.projectsDir });
    const gh = fakeGh();

    const result = await pr.run({ repo: REPO, runBranch: "feature", base: "develop" }, { gh, adapter });
    expect(result.status).toBe("passed");
    // title derived from the transcript's first user prompt
    expect(result.data).toMatchObject({ action: "created", title: "Add a multiply function with tests" });
  });

  it("updates an existing open PR instead of creating a new one", async () => {
    const existing: Record<string, PullRequest> = {
      feature: { number: 5, url: "https://github.com/demo/repo/pull/5", state: "OPEN", baseRefName: "main", headRefName: "feature" },
    };
    const gh = fakeGh({}, { prs: existing });
    const result = await pr.run({ repo: REPO, runBranch: "feature", base: "develop", title: "t", body: "b" }, { gh });

    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ action: "updated", number: 5, base: "develop" });
    expect(gh.calls).toContain("edit:feature");
    expect(gh.prs.get("feature")?.baseRefName).toBe("develop"); // base re-pointed
  });

  it("fails cleanly when gh cannot create the PR", async () => {
    const gh = fakeGh({}, { failCreate: true });
    const result = await pr.run({ repo: REPO, runBranch: "feature", base: "develop", title: "t", body: "b" }, { gh });
    expect(result.status).toBe("failed");
    expect(result.findings[0]).toMatchObject({ id: "pr.failed", action: "ask-user" });
  });
});
