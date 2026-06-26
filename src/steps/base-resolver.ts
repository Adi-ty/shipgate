import { finding, stepResult, type StepResult } from "../core/findings.js";
import type { ShipgateConfig } from "../core/config.js";
import type { GitPort } from "../ports/git.js";
import type { GhPort } from "../ports/gh.js";

export interface ResolveBaseInput {
  repo: string;
  runBranch: string;
  remote?: string;
  /** Explicit base override (e.g. `--base` or a push option). */
  override?: string;
  config: ShipgateConfig;
  /** WEAK hint only (e.g. session intent text). Recorded but never decisive. */
  intentText?: string;
  git: GitPort;
  gh: GhPort;
}

interface MeasuredCandidate {
  branch: string;
  mergeBase: string;
  distance: number;
}

/** Anchored glob matcher: `*` → any, `?` → one char. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Resolve the integration/base branch for a run branch, emitting which rule fired.
 *
 * Priority (each stops on a hit):
 *  1. open-pr            — an existing PR's base is authoritative
 *  2. override           — explicit `--base`, else first matching config glob rule
 *  3. nearest-divergence — integration branch with the smallest commit-distance
 *  4. ambiguous          — a true tie → ask-user; never silently pick
 *
 * Git is always decisive; `intentText` is recorded in evidence but never affects
 * the outcome.
 */
export async function resolveBase(input: ResolveBaseInput): Promise<StepResult> {
  const remote = input.remote ?? "origin";
  const runBranch = input.runBranch;
  const intentHint = input.intentText?.trim() ? input.intentText.trim() : null;
  const evidenceBase = { remote, intentHint };

  // ── Rule 1: open PR wins ────────────────────────────────────────────────
  let prBase: string | null;
  try {
    prBase = await input.gh.prViewBaseRef(input.repo, runBranch);
  } catch (err) {
    const message = (err as Error).message;
    return stepResult({
      step: "base",
      status: "failed",
      findings: [
        finding({
          id: "base.gh-unavailable",
          severity: "error",
          action: "ask-user",
          message: `Could not query gh for an existing PR: ${message}`,
        }),
      ],
      data: { rule: "gh-error", resolvedBase: null, runBranch },
      evidence: { ...evidenceBase, ghError: message },
    });
  }
  if (prBase) {
    return stepResult({
      step: "base",
      status: "passed",
      data: { rule: "open-pr", resolvedBase: prBase, runBranch },
      evidence: { ...evidenceBase, ghPrBaseRefName: prBase },
    });
  }

  // ── Rule 2: explicit override, else config glob ─────────────────────────
  let overrideBranch: string | null = null;
  let overrideRule: "override-flag" | "override-config-glob" | null = null;
  let matchedRule: { when: string; use: string } | undefined;

  if (input.override && input.override.trim()) {
    overrideBranch = input.override.trim();
    overrideRule = "override-flag";
  } else {
    for (const r of input.config.base.rules) {
      if (globToRegExp(r.when).test(runBranch)) {
        overrideBranch = r.use;
        overrideRule = "override-config-glob";
        matchedRule = r;
        break;
      }
    }
  }

  if (overrideBranch && overrideRule) {
    const exists = await input.git.remoteBranchExists(input.repo, remote, overrideBranch);
    const data: Record<string, unknown> = {
      rule: overrideRule,
      resolvedBase: exists ? overrideBranch : null,
      runBranch,
      ...(matchedRule ? { matchedRule } : {}),
    };
    const evidence = { ...evidenceBase, overrideFlag: input.override?.trim() ? input.override.trim() : null };
    if (!exists) {
      return stepResult({
        step: "base",
        status: "findings",
        findings: [
          finding({
            id: "base.override-missing",
            severity: "error",
            action: "ask-user",
            message: `Configured base '${overrideBranch}' does not exist on '${remote}'.`,
            data: { branch: overrideBranch },
          }),
        ],
        data,
        evidence,
      });
    }
    return stepResult({ step: "base", status: "passed", data, evidence });
  }

  // ── Rule 3: nearest divergence ──────────────────────────────────────────
  const remoteBranches = await input.git.listRemoteBranches(input.repo, remote);
  const integration = new Set(input.config.base.integrationBranches);
  const releaseRegexes = input.config.base.releaseGlobs.map(globToRegExp);
  const candidates = remoteBranches
    .filter((b) => b !== runBranch)
    .filter((b) => integration.has(b) || releaseRegexes.some((re) => re.test(b)))
    .sort();

  const measured: MeasuredCandidate[] = [];
  for (const c of candidates) {
    const mb = await input.git.mergeBase(input.repo, `${remote}/${c}`, runBranch);
    if (!mb) continue; // unrelated history → skip, do not crash
    const distance = await input.git.revListCount(input.repo, `${mb}..${runBranch}`);
    measured.push({ branch: c, mergeBase: mb, distance });
  }

  if (measured.length === 0) {
    return stepResult({
      step: "base",
      status: "findings",
      findings: [
        finding({
          id: "base.no-candidates",
          severity: "error",
          action: "ask-user",
          message: `No related integration branch found on '${remote}' to use as a base.`,
          data: { candidates },
        }),
      ],
      data: { rule: "no-candidates", resolvedBase: null, runBranch },
      evidence: { ...evidenceBase, candidates: [] },
    });
  }

  measured.sort((a, b) => a.distance - b.distance || a.branch.localeCompare(b.branch));
  const minDistance = measured[0]!.distance;
  const contenders = measured.filter((m) => m.distance === minDistance);

  let chosen: MeasuredCandidate | null;
  if (contenders.length === 1) {
    chosen = contenders[0]!;
  } else {
    // Equal distance: a candidate that is a descendant of all the others is
    // unambiguously nearer the tip (e.g. develop ⊂ release/v2 → pick release/v2).
    const descendants: MeasuredCandidate[] = [];
    for (const x of contenders) {
      const others = contenders.filter((c) => c !== x);
      const checks = await Promise.all(
        others.map((y) => input.git.isAncestor(input.repo, `${remote}/${y.branch}`, `${remote}/${x.branch}`)),
      );
      if (checks.every(Boolean)) descendants.push(x);
    }
    chosen = descendants.length === 1 ? descendants[0]! : null;
  }

  const candidateEvidence = (chosenBranch: string | null) =>
    measured.map((m) => ({ ...m, chosen: m.branch === chosenBranch }));

  if (!chosen) {
    const tied = contenders.map((c) => c.branch);
    const quoted = tied.map((b) => `'${b}'`).join(" and ");
    return stepResult({
      step: "base",
      status: "findings",
      findings: [
        finding({
          id: "base.ambiguous",
          severity: "error",
          action: "ask-user",
          message: `Base branch is ambiguous: ${quoted} diverged equally close. Choose one.`,
          data: { candidates: tied },
        }),
      ],
      data: { rule: "ambiguous", resolvedBase: null, runBranch },
      evidence: { ...evidenceBase, candidates: candidateEvidence(null) },
    });
  }

  return stepResult({
    step: "base",
    status: "passed",
    data: { rule: "nearest-divergence", resolvedBase: chosen.branch, runBranch },
    evidence: { ...evidenceBase, candidates: candidateEvidence(chosen.branch) },
  });
}
