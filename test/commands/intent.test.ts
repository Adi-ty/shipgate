import { describe, it, expect, afterEach } from "vitest";
import * as intent from "../../src/commands/intent.js";
import { ClaudeCodeAdapter } from "../../src/core/agents/claude-code.js";
import { createTranscriptFixture, SAMPLE_LINES, type TranscriptFixture } from "../helpers/transcript-fixture.js";

const REPO = "/Users/demo/Projects/widget";

describe("intent command", () => {
  let fx: TranscriptFixture;
  afterEach(() => fx?.cleanup());

  it("a --intent override wins and never reads a transcript", async () => {
    const result = await intent.run({ repo: REPO, intent: "  Add multiply and division  " });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ summary: "Add multiply and division", source: "manual", matchScore: 1, sessionId: null });
  });

  it("resolves intent from the most recent transcript", async () => {
    fx = createTranscriptFixture();
    fx.writeTranscript(REPO, "sess1", SAMPLE_LINES);
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const result = await intent.run({ repo: REPO }, { adapter });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({
      summary: "Add a multiply function with tests",
      source: "claude-code",
      matchScore: 1,
      sessionId: "sess1",
    });
    expect((result.evidence as { transcriptCount: number }).transcriptCount).toBe(1);
  });

  it("skips gracefully with a hint when no transcript is found", async () => {
    fx = createTranscriptFixture();
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const result = await intent.run({ repo: "/no/such/repo" }, { adapter });
    expect(result.status).toBe("skipped");
    expect(result.findings[0]).toMatchObject({ id: "intent.no-transcript", action: "no-op" });
    expect(result.data).toMatchObject({ summary: null, source: "none", matchScore: 0 });
  });
});
