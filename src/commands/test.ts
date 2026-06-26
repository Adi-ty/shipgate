import { loadConfig } from "../core/config.js";
import { pickAdapter } from "../core/stacks/detect.js";
import { resolveCommand, type StackAdapter } from "../core/stacks/adapter.js";
import { finding, stepResult, type StepResult } from "../core/findings.js";
import { runCommandStep } from "./shared.js";

export interface TestOptions {
  repo?: string;
}

export interface TestDeps {
  /** Inject an adapter (or null) to bypass detection in tests. */
  adapter?: StackAdapter | null;
}

/** `shipgate test` — run the resolved test command and report pass/fail. */
export async function run(opts: TestOptions, deps: TestDeps = {}): Promise<StepResult> {
  const repoRoot = opts.repo ?? process.cwd();
  const config = await loadConfig({ cwd: repoRoot });
  const adapter = deps.adapter !== undefined ? deps.adapter : await pickAdapter(repoRoot);

  const resolved = await resolveCommand("test", { repoRoot, config, adapter });
  if (!resolved) {
    return stepResult({
      step: "test",
      status: "skipped",
      findings: [
        finding({
          id: "test.no-command",
          severity: "info",
          action: "no-op",
          message: `No test command configured (stack: ${adapter?.name ?? "unknown"}). Set commands.test in .shipgate.yaml.`,
        }),
      ],
      data: { command: null, source: "none", stack: adapter?.name ?? null },
    });
  }

  return runCommandStep({ step: "test", resolved, repoRoot });
}
