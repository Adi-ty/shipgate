import { execShell } from "../core/exec.js";
import { loadConfig } from "../core/config.js";
import { pickAdapter } from "../core/stacks/detect.js";
import { resolveCommand, resolveFixCommand, type StackAdapter } from "../core/stacks/adapter.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import { runCommandStep, tail } from "./shared.js";

export interface LintOptions {
  repo?: string;
  /** Apply the auto-fixable subset (adapter's fix command) before checking. */
  fix?: boolean;
}

export interface LintDeps {
  /** Inject an adapter (or null) to bypass detection in tests. */
  adapter?: StackAdapter | null;
}

/** `shipgate lint` — run the resolved lint command, optionally auto-fixing first. */
export async function run(opts: LintOptions, deps: LintDeps = {}): Promise<StepResult> {
  const repoRoot = opts.repo ?? process.cwd();
  const config = await loadConfig({ cwd: repoRoot });
  const adapter = deps.adapter !== undefined ? deps.adapter : await pickAdapter(repoRoot);

  // Optional auto-fix pass (best-effort, from the adapter).
  let fixApplied = false;
  const fixEvidence: Record<string, unknown> = {};
  if (opts.fix) {
    const fix = await resolveFixCommand({ repoRoot, adapter });
    if (fix) {
      const fr = await execShell(fix.shell, { cwd: repoRoot });
      fixApplied = true;
      fixEvidence.fix = { command: fix.shell, exitCode: fr.exitCode, stdoutTail: tail(fr.stdout) };
    } else {
      fixEvidence.fix = { skipped: "no auto-fix command available" };
    }
  }

  const resolved = await resolveCommand("lint", { repoRoot, config, adapter });
  if (!resolved) {
    return stepResult({
      step: "lint",
      status: "skipped",
      findings: [
        finding({
          id: "lint.no-command",
          severity: "info",
          action: "no-op",
          message: `No lint command configured (stack: ${adapter?.name ?? "unknown"}). Set commands.lint in .shipgate.yaml.`,
        }),
      ],
      data: { command: null, source: "none", stack: adapter?.name ?? null, fixApplied },
      ...(Object.keys(fixEvidence).length ? { evidence: fixEvidence } : {}),
    });
  }

  return runCommandStep({
    step: "lint",
    resolved,
    repoRoot,
    extraData: { fixApplied },
    extraEvidence: fixEvidence,
  });
}
