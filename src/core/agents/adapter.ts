/**
 * The agent (harness) adapter layer. The pipeline is agent-agnostic: the two
 * agent-specific concerns — reading session transcripts (for `intent`) and
 * invoking the agent (for review / auto-fix) — sit behind this one interface.
 * v1 ships exactly one implementation (Claude Code). Adding another harness is
 * one new file with no pipeline changes.
 */

/** A discovered session transcript on disk. */
export interface TranscriptRef {
  sessionId: string;
  path: string;
  mtimeMs: number;
}

/** The intent extracted from a single transcript (no cross-transcript scoring). */
export interface ParsedTranscript {
  summary: string;
  sessionId: string;
  /** Count of genuine user prompts (tool results / command wrappers excluded). */
  userTurns: number;
}

/** The resolved intent the `intent` command emits. */
export interface SessionIntent {
  summary: string;
  sessionId: string | null;
  /** Harness identifier, e.g. "claude-code" (or "manual" for an override). */
  source: string;
  /** Confidence this transcript corresponds to the current changes (0..1). */
  matchScore: number;
  userTurns: number | null;
}

export interface IntentResolution {
  intent: SessionIntent;
  transcriptPath: string;
  transcriptCount: number;
}

export interface AgentInvocation {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface AgentAdapter {
  readonly name: string;
  /** Discover this repo's session transcripts, newest first. */
  findTranscripts(repoRoot: string): Promise<TranscriptRef[]>;
  /** Parse a single transcript into a structured intent. */
  readIntent(ref: TranscriptRef): Promise<ParsedTranscript>;
  /** Discover + parse + score the most recent transcript, or null if none. */
  resolveIntent(repoRoot: string): Promise<IntentResolution | null>;
  /** Invoke the agent headlessly (used by review / auto-fix in later slices). */
  invoke(prompt: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<AgentInvocation>;
}
