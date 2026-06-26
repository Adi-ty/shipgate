/**
 * The structured I/O contract shared by every shipgate command.
 *
 * Defined once here and reused everywhere. The CLI (the "hands") emits these;
 * the SKILL.md (the "brain") reads `StepResult.status`, `StepResult.findings[].action`,
 * and the documented `data.*` decision fields to drive the pipeline.
 */

export type Severity = "error" | "warning" | "info";

/**
 * What the agent should do about a finding:
 * - `auto-fix`  → loop the agent within the step's limit
 * - `ask-user`  → pause for the human
 * - `no-op`     → informational only
 */
export type Action = "auto-fix" | "ask-user" | "no-op";

export type Status = "passed" | "findings" | "skipped" | "failed";

export interface Finding {
  id: string;
  severity: Severity;
  action: Action;
  message: string;
  location?: { file: string; line?: number };
  data?: Record<string, unknown>;
}

export interface StepResult {
  step: string;
  status: Status;
  findings: Finding[];
  /**
   * Machine-readable decision fields the skill reads deterministically
   * (e.g. `resolvedBase`, `rule`, `skipRemaining`). Distinct from `evidence`,
   * which is raw audit observation. Extends the base contract additively.
   */
  data?: Record<string, unknown>;
  /** Raw observations for audit (e.g. test counts, candidate distances, log paths). */
  evidence?: Record<string, unknown>;
}

/** Build a Finding; keeps construction terse and consistent across steps. */
export function finding(input: Finding): Finding {
  return input;
}

/** Build a StepResult, defaulting findings to an empty array. */
export function stepResult(input: {
  step: string;
  status: Status;
  findings?: Finding[];
  data?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}): StepResult {
  return {
    step: input.step,
    status: input.status,
    findings: input.findings ?? [],
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
  };
}
