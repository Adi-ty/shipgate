import { readFile } from "node:fs/promises";
import { currentBranch } from "../core/git.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import { realGh, type GhPort } from "../ports/gh.js";
import { ClaudeCodeAdapter } from "../core/agents/claude-code.js";
import type { AgentAdapter } from "../core/agents/adapter.js";

export interface PrOptions {
  repo?: string;
  /** Head branch (default current branch). */
  runBranch?: string;
  /** Base branch (the resolved integration branch). */
  base: string;
  title?: string;
  body?: string;
  bodyFile?: string;
  draft?: boolean;
}

export interface PrDeps {
  gh?: GhPort;
  /** Used to build the body/title from session intent when not supplied. */
  adapter?: AgentAdapter;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/**
 * `shipgate pr` — create or update the PR. base = the resolved integration
 * branch; the body is built from the captured session intent unless supplied.
 */
export async function run(opts: PrOptions, deps: PrDeps = {}): Promise<StepResult> {
  const gh = deps.gh ?? realGh;
  const adapter = deps.adapter ?? new ClaudeCodeAdapter();
  const repoRoot = opts.repo ?? process.cwd();
  const runBranch = opts.runBranch ?? (await currentBranch(repoRoot));

  if (!runBranch) {
    return stepResult({
      step: "pr",
      status: "failed",
      findings: [
        finding({ id: "pr.no-run-branch", severity: "error", action: "ask-user", message: "Could not determine the head branch (detached HEAD); pass --run-branch." }),
      ],
      data: { base: opts.base, head: null },
    });
  }

  // Resolve title + body. Explicit values win; otherwise build from session intent.
  let body = opts.body;
  if (!body && opts.bodyFile) {
    try {
      body = await readFile(opts.bodyFile, "utf8");
    } catch (err) {
      return stepResult({
        step: "pr",
        status: "failed",
        findings: [finding({ id: "pr.body-file", severity: "error", action: "ask-user", message: `Could not read --body-file: ${(err as Error).message}` })],
        data: { base: opts.base, head: runBranch },
      });
    }
  }
  let title = opts.title;
  if (!body || !title) {
    const res = await adapter.resolveIntent(repoRoot);
    const summary = res?.intent.summary;
    if (!body) {
      body = summary
        ? `${summary}\n\n---\n_Opened by shipgate (session ${res?.intent.sessionId ?? "n/a"})._`
        : `Changes from \`${runBranch}\`.\n\n---\n_Opened by shipgate._`;
    }
    if (!title) title = summary ? truncate(summary, 72) : `${runBranch} → ${opts.base}`;
  }

  try {
    const existing = await gh.prView(repoRoot, runBranch);
    if (existing && existing.state === "OPEN") {
      await gh.prEdit(repoRoot, runBranch, { base: opts.base, title, body });
      const data = { action: "updated", number: existing.number, url: existing.url, base: opts.base, head: runBranch, title };
      return stepResult({ step: "pr", status: "passed", data, evidence: { state: existing.state } });
    }
    const created = await gh.prCreate(repoRoot, { base: opts.base, head: runBranch, title, body, draft: opts.draft });
    const data = { action: "created", number: created.number, url: created.url, base: opts.base, head: runBranch, title };
    return stepResult({ step: "pr", status: "passed", data, evidence: { draft: opts.draft ?? false } });
  } catch (err) {
    return stepResult({
      step: "pr",
      status: "failed",
      findings: [finding({ id: "pr.failed", severity: "error", action: "ask-user", message: `gh PR operation failed: ${(err as Error).message}` })],
      data: { base: opts.base, head: runBranch },
    });
  }
}
