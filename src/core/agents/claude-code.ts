import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec } from "../exec.js";
import type {
  AgentAdapter,
  AgentInvocation,
  IntentResolution,
  ParsedTranscript,
  SessionIntent,
  TranscriptRef,
} from "./adapter.js";

const MAX_SUMMARY = 600;

/** Claude Code escapes a repo's cwd into its projects-dir name by `/` → `-`. */
export function escapeProjectPath(repoRoot: string): string {
  return repoRoot.replace(/\//g, "-");
}

interface TranscriptLine {
  type?: string;
  message?: { content?: unknown };
}

/** The only v1 AgentAdapter: reads Claude Code session transcripts and invokes `claude`. */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  private readonly projectsDir: string;
  private readonly agentBin: string;

  constructor(opts: { projectsDir?: string; agentBin?: string } = {}) {
    this.projectsDir = opts.projectsDir ?? join(homedir(), ".claude", "projects");
    this.agentBin = opts.agentBin ?? "claude";
  }

  async findTranscripts(repoRoot: string): Promise<TranscriptRef[]> {
    const dir = join(this.projectsDir, escapeProjectPath(repoRoot));
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return []; // no transcripts for this repo
    }
    const refs: TranscriptRef[] = [];
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(dir, name);
      try {
        const s = await stat(path);
        if (!s.isFile()) continue;
        refs.push({ sessionId: name.slice(0, -".jsonl".length), path, mtimeMs: s.mtimeMs });
      } catch {
        continue;
      }
    }
    refs.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
    return refs;
  }

  async readIntent(ref: TranscriptRef): Promise<ParsedTranscript> {
    const text = await readFile(ref.path, "utf8");
    const userTexts: string[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj: TranscriptLine;
      try {
        obj = JSON.parse(line) as TranscriptLine;
      } catch {
        continue;
      }
      if (obj.type !== "user") continue;
      const t = extractUserText(obj.message?.content);
      if (t) userTexts.push(t);
    }
    return {
      summary: condense(userTexts[0] ?? "", MAX_SUMMARY),
      sessionId: ref.sessionId,
      userTurns: userTexts.length,
    };
  }

  async resolveIntent(repoRoot: string): Promise<IntentResolution | null> {
    const refs = await this.findTranscripts(repoRoot);
    if (refs.length === 0) return null;
    const ref = refs[0]!;
    const parsed = await this.readIntent(ref);
    const intent: SessionIntent = {
      summary: parsed.summary,
      sessionId: parsed.sessionId,
      source: this.name,
      // Single transcript → high confidence; multiple → we picked the newest, so flag it.
      matchScore: refs.length === 1 ? 1 : 0.6,
      userTurns: parsed.userTurns,
    };
    return { intent, transcriptPath: ref.path, transcriptCount: refs.length };
  }

  async invoke(prompt: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<AgentInvocation> {
    // Headless print mode. review/auto-fix (later slices) will extend the flags.
    const r = await exec(this.agentBin, ["-p", prompt], { cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    return { output: r.stdout, exitCode: r.exitCode, timedOut: r.timedOut };
  }
}

function isTextBlock(b: unknown): b is { type: "text"; text: string } {
  return (
    typeof b === "object" &&
    b !== null &&
    (b as { type?: unknown }).type === "text" &&
    typeof (b as { text?: unknown }).text === "string"
  );
}

/** Pull genuine user prose from a message's content; null for tool-result-only turns. */
function extractUserText(content: unknown): string | null {
  if (typeof content === "string") return cleanProse(content);
  if (Array.isArray(content)) {
    const texts = content.filter(isTextBlock).map((b) => b.text);
    if (texts.length === 0) return null; // e.g. a tool_result-only user line
    return cleanProse(texts.join("\n"));
  }
  return null;
}

/** Drop empty / non-prose injected turns (command wrappers, lone system reminders). */
function cleanProse(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("<command-")) return null;
  if (trimmed.startsWith("<system-reminder>") && trimmed.endsWith("</system-reminder>")) return null;
  return trimmed;
}

function condense(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1).trimEnd() + "…" : oneLine;
}
