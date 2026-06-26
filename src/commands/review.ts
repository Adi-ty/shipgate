import { readFile } from "node:fs/promises";
import { realGit } from "../core/git.js";
import { finding, stepResult, type Finding, type StepResult, type Severity, type Action } from "../core/findings.js";
import { resolveBaseRef } from "./shared.js";
import type { GitPort } from "../ports/git.js";

export interface ReviewOptions {
  repo?: string;
  runBranch?: string;
  base: string;
  remote?: string;
  /** A JSON file of Finding[] produced by the agent's review, to merge into the result. */
  findingsFile?: string;
}

export interface ReviewDeps {
  git?: GitPort;
}

const DIFF_CAP = 100_000; // chars of unified diff carried inline
const SEVERITIES: Severity[] = ["error", "warning", "info"];
const ACTIONS: Action[] = ["auto-fix", "ask-user", "no-op"];

/** Validate + coerce agent-supplied findings from a JSON file. */
function coerceFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Record<string, unknown>;
    if (typeof f.id !== "string" || typeof f.message !== "string") continue;
    const severity = SEVERITIES.includes(f.severity as Severity) ? (f.severity as Severity) : "warning";
    const action = ACTIONS.includes(f.action as Action) ? (f.action as Action) : "ask-user";
    out.push(finding({ id: f.id, severity, action, message: f.message }));
  }
  return out;
}

/**
 * `shipgate review` — package the diff vs the resolved base for an agent to review,
 * and collect the agent's findings. The CLI does NOT judge the code; it provides the
 * I/O. Review ALWAYS pauses for a human: the result carries a `review.gate` ask-user
 * finding whenever there are changes.
 */
export async function run(opts: ReviewOptions, deps: ReviewDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const remote = opts.remote ?? "origin";
  const runBranch = opts.runBranch ?? "HEAD";

  const baseRef = await resolveBaseRef(git, repoRoot, remote, opts.base);
  if (!baseRef) {
    return stepResult({
      step: "review",
      status: "failed",
      findings: [finding({ id: "review.base-not-found", severity: "error", action: "ask-user", message: `Base '${opts.base}' not found on '${remote}' or locally.` })],
      data: { base: opts.base, runBranch },
    });
  }

  const range = `${baseRef}...${runBranch}`;
  const files = await git.diffFiles(repoRoot, range);
  if (files.length === 0) {
    return stepResult({
      step: "review",
      status: "skipped",
      findings: [finding({ id: "review.no-changes", severity: "info", action: "no-op", message: `No changes vs '${opts.base}' to review.` })],
      data: { base: opts.base, baseRef, runBranch, filesChanged: 0 },
    });
  }

  const diff = await git.diffText(repoRoot, range);
  const stat = await git.diffStat(repoRoot, range);

  const findings: Finding[] = [];
  if (opts.findingsFile) {
    try {
      findings.push(...coerceFindings(JSON.parse(await readFile(opts.findingsFile, "utf8"))));
    } catch (err) {
      findings.push(finding({ id: "review.findings-file-error", severity: "warning", action: "no-op", message: `Could not read --findings-file: ${(err as Error).message}` }));
    }
  }
  const agentFindings = findings.length;
  // The non-negotiable human gate.
  findings.push(finding({ id: "review.gate", severity: "info", action: "ask-user", message: "Human approval required: review the diff before shipping." }));

  return stepResult({
    step: "review",
    status: "findings",
    findings,
    data: {
      base: opts.base,
      baseRef,
      runBranch,
      filesChanged: files.length,
      changedFiles: files.map((f) => f.file),
    },
    evidence: {
      diffStat: stat,
      diffCommand: `git diff ${range}`,
      diff: diff.slice(0, DIFF_CAP),
      diffTruncated: diff.length > DIFF_CAP,
      agentFindings,
    },
  });
}
