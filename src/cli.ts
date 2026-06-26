#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { printStepResult, printHuman, exitCodeFor } from "./core/json.js";
import type { StepResult } from "./core/findings.js";
import * as worktree from "./commands/worktree.js";
import * as base from "./commands/base.js";
import * as rebase from "./commands/rebase.js";
import * as lint from "./commands/lint.js";
import * as test from "./commands/test.js";

function emit(result: StepResult, json: boolean): void {
  if (json) printStepResult(result);
  else printHuman(result);
  process.exitCode = exitCodeFor(result);
}

/**
 * Run a command body and emit its StepResult. A thrown error becomes a `failed`
 * StepResult rather than an uncaught crash — every command speaks the contract.
 */
async function guard(step: string, json: boolean, fn: () => Promise<StepResult>): Promise<void> {
  try {
    emit(await fn(), json);
  } catch (err) {
    emit(
      {
        step,
        status: "failed",
        findings: [
          { id: `${step}.error`, severity: "error", action: "ask-user", message: (err as Error).message },
        ],
      },
      json,
    );
  }
}

const program = new Command();
program
  .name("shipgate")
  .description("Post-session ship-it pipeline for AI-agent-written code")
  .version("0.1.0");

// One run id per invocation — the ONLY non-deterministic input, generated here
// at the glue layer and threaded into the deterministic steps.
const runId = randomUUID().slice(0, 8);

const wt = program.command("worktree").description("manage the isolated run worktree");

wt.command("create")
  .description("create a disposable detached worktree on the run-scoped branch")
  .option("--run-id <id>", "run id (default: generated per invocation)", runId)
  .option("--repo <path>", "repo path (default: cwd)")
  .option("--json", "emit machine-readable JSON", false)
  .action((opts) => guard("worktree.create", opts.json, () => worktree.runCreate({ runId: opts.runId, repo: opts.repo })));

wt.command("remove")
  .description("remove the run worktree and prune")
  .option("--run-id <id>", "run id", runId)
  .option("--repo <path>", "repo path (default: cwd)")
  .option("--json", "emit machine-readable JSON", false)
  .action((opts) => guard("worktree.remove", opts.json, () => worktree.runRemove({ runId: opts.runId, repo: opts.repo })));

program
  .command("base")
  .description("resolve the integration/base branch")
  .option("--run-branch <name>", "run branch (default: current branch)")
  .option("--base <branch>", "explicit base override")
  .option("--remote <name>", "remote", "origin")
  .option("--intent-hint <text>", "weak intent hint (recorded only, never decisive)")
  .option("--repo <path>", "repo path (default: cwd)")
  .option("--json", "emit machine-readable JSON", false)
  .action((opts) =>
    guard("base", opts.json, () =>
      base.run({
        runBranch: opts.runBranch,
        base: opts.base,
        remote: opts.remote,
        intentHint: opts.intentHint,
        repo: opts.repo,
      }),
    ),
  );

program
  .command("rebase")
  .description("rebase the run branch onto the resolved base")
  .requiredOption("--base <branch>", "resolved base branch")
  .option("--run-branch <name>", "run branch (default: current branch)")
  .option("--remote <name>", "remote", "origin")
  .option("--repo <path>", "repo path (default: cwd)")
  .option("--json", "emit machine-readable JSON", false)
  .action((opts) =>
    guard("rebase", opts.json, () =>
      rebase.run({ base: opts.base, runBranch: opts.runBranch, remote: opts.remote, repo: opts.repo }),
    ),
  );

program
  .command("lint")
  .description("run the resolved lint command (stack-detected or configured)")
  .option("--repo <path>", "repo path (default: cwd)")
  .option("--fix", "apply the auto-fixable subset before checking", false)
  .option("--json", "emit machine-readable JSON", false)
  .action((opts) => guard("lint", opts.json, () => lint.run({ repo: opts.repo, fix: opts.fix })));

program
  .command("test")
  .description("run the resolved test command (stack-detected or configured)")
  .option("--repo <path>", "repo path (default: cwd)")
  .option("--json", "emit machine-readable JSON", false)
  .action((opts) => guard("test", opts.json, () => test.run({ repo: opts.repo })));

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
