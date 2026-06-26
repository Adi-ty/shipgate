import { describe, it, expect, afterEach } from "vitest";
import { ClaudeCodeAdapter, escapeProjectPath } from "../../../src/core/agents/claude-code.js";
import { createTranscriptFixture, SAMPLE_LINES, type TranscriptFixture } from "../../helpers/transcript-fixture.js";

const REPO = "/Users/demo/Projects/widget";

describe("ClaudeCodeAdapter", () => {
  let fx: TranscriptFixture;
  afterEach(() => fx?.cleanup());

  it("escapeProjectPath replaces slashes with dashes", () => {
    expect(escapeProjectPath("/Users/adi/Projects/shipgate")).toBe("-Users-adi-Projects-shipgate");
  });

  it("findTranscripts returns this repo's transcripts, newest first", async () => {
    fx = createTranscriptFixture();
    fx.writeTranscript(REPO, "older", SAMPLE_LINES, 1_000_000_000_000);
    fx.writeTranscript(REPO, "newer", SAMPLE_LINES, 2_000_000_000_000);
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const refs = await adapter.findTranscripts(REPO);
    expect(refs.map((r) => r.sessionId)).toEqual(["newer", "older"]);
  });

  it("findTranscripts returns [] when there are no transcripts", async () => {
    fx = createTranscriptFixture();
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });
    expect(await adapter.findTranscripts("/no/such/repo")).toEqual([]);
  });

  it("readIntent extracts the first user prompt and counts genuine turns", async () => {
    fx = createTranscriptFixture();
    const path = fx.writeTranscript(REPO, "sess1", SAMPLE_LINES);
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const parsed = await adapter.readIntent({ sessionId: "sess1", path, mtimeMs: 0 });
    expect(parsed.summary).toBe("Add a multiply function with tests");
    // string prompt + array-text prompt = 2; tool_result and command wrapper excluded
    expect(parsed.userTurns).toBe(2);
    expect(parsed.sessionId).toBe("sess1");
  });

  it("readIntent condenses whitespace and truncates long prompts", async () => {
    fx = createTranscriptFixture();
    const long = "word ".repeat(400); // ~2000 chars
    const path = fx.writeTranscript(REPO, "big", [{ type: "user", message: { content: `do\n\n  this:  ${long}` } }]);
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const parsed = await adapter.readIntent({ sessionId: "big", path, mtimeMs: 0 });
    expect(parsed.summary.length).toBeLessThanOrEqual(600);
    expect(parsed.summary.endsWith("…")).toBe(true);
    expect(parsed.summary).not.toMatch(/\n/);
  });

  it("resolveIntent scores a single transcript at 1.0", async () => {
    fx = createTranscriptFixture();
    fx.writeTranscript(REPO, "solo", SAMPLE_LINES);
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const res = await adapter.resolveIntent(REPO);
    expect(res?.intent).toMatchObject({ source: "claude-code", matchScore: 1, summary: "Add a multiply function with tests" });
    expect(res?.transcriptCount).toBe(1);
  });

  it("resolveIntent picks the newest and lowers matchScore when several exist", async () => {
    fx = createTranscriptFixture();
    fx.writeTranscript(REPO, "old", [{ type: "user", message: { content: "old task" } }], 1_000_000_000_000);
    fx.writeTranscript(REPO, "new", [{ type: "user", message: { content: "new task" } }], 2_000_000_000_000);
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });

    const res = await adapter.resolveIntent(REPO);
    expect(res?.intent).toMatchObject({ sessionId: "new", matchScore: 0.6, summary: "new task" });
    expect(res?.transcriptCount).toBe(2);
  });

  it("resolveIntent returns null when there is no transcript", async () => {
    fx = createTranscriptFixture();
    const adapter = new ClaudeCodeAdapter({ projectsDir: fx.projectsDir });
    expect(await adapter.resolveIntent("/no/such/repo")).toBeNull();
  });

  it("invoke shells out to the configured agent binary", async () => {
    const adapter = new ClaudeCodeAdapter({ agentBin: "echo" });
    const r = await adapter.invoke("review this diff");
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("review this diff");
  });
});
