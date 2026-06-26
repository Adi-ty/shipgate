import type { StepResult } from "./findings.js";

/**
 * Emit a StepResult as the schema-stable `--json` payload.
 *
 * v1 prints the bare StepResult exactly as defined in findings.ts (a top-level
 * `schemaVersion` can be added later non-breakingly). The two-space indent keeps
 * output diff-friendly while staying valid for piping into `jq`.
 */
export function printStepResult(result: StepResult, write: (s: string) => void = (s) => process.stdout.write(s)): void {
  write(JSON.stringify(result, null, 2) + "\n");
}

/** Compact human-facing summary (the non-`--json` default). */
export function printHuman(result: StepResult, write: (s: string) => void = (s) => process.stdout.write(s)): void {
  const scalars = Object.entries(result.data ?? {})
    .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  write(`[${result.step}] ${result.status}${scalars ? ` — ${scalars}` : ""}\n`);
  for (const f of result.findings) {
    write(`  • ${f.severity}/${f.action}: ${f.message}\n`);
  }
}

/** Process exit code derived from a step's status: non-blocking outcomes are 0. */
export function exitCodeFor(result: StepResult): number {
  switch (result.status) {
    case "passed":
    case "skipped":
      return 0;
    case "findings":
      // Blocking iff any finding requires a human or a fix.
      return result.findings.some((f) => f.action !== "no-op") ? 1 : 0;
    case "failed":
      return 1;
    default:
      return 1;
  }
}
