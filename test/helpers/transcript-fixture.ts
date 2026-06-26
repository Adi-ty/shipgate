import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Builds a fake Claude Code projects directory so the adapter can be tested
 * without touching the real ~/.claude. Mirrors the real layout:
 *   <projectsDir>/<repoPath with / → ->/<sessionId>.jsonl
 */
export interface TranscriptFixture {
  projectsDir: string;
  /** Write a transcript; `mtimeMs` lets tests control newest-first ordering. */
  writeTranscript(repoPath: string, sessionId: string, lines: object[], mtimeMs?: number): string;
  cleanup(): void;
}

export function createTranscriptFixture(): TranscriptFixture {
  const projectsDir = mkdtempSync(join(tmpdir(), "shipgate-transcripts-"));
  return {
    projectsDir,
    writeTranscript(repoPath, sessionId, lines, mtimeMs) {
      const dir = join(projectsDir, repoPath.replace(/\//g, "-"));
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${sessionId}.jsonl`);
      writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      if (mtimeMs !== undefined) {
        const secs = mtimeMs / 1000;
        utimesSync(path, secs, secs);
      }
      return path;
    },
    cleanup: () => rmSync(projectsDir, { recursive: true, force: true }),
  };
}

/** A small but realistic transcript: a string prompt, a tool-result turn, an array-text prompt, a command wrapper. */
export const SAMPLE_LINES: object[] = [
  { type: "user", message: { content: "Add a multiply function with tests" } },
  { type: "assistant", message: { content: [{ type: "text", text: "On it" }, { type: "tool_use", name: "Edit", input: {} }] } },
  { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }, // tool result → ignored
  { type: "user", message: { content: [{ type: "text", text: "also handle negatives" }] } }, // genuine (array text)
  { type: "user", message: { content: "<command-name>clear</command-name>" } }, // command wrapper → ignored
];
