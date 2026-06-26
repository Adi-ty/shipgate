import { access, readFile } from "node:fs/promises";
import type { ShipgateConfig } from "../config.js";

/**
 * The stack adapter layer is what makes shipgate "work for every project". The
 * pipeline owns ZERO hardcoded tool knowledge: it asks the resolved adapter for
 * the concrete test/lint/format commands and runs whatever it gets back. Adding
 * a stack is adding one adapter file — never editing the pipeline.
 */

export type CommandKind = "test" | "lint" | "format";

export interface ResolvedCommand {
  kind: CommandKind;
  /** Full command line, executed via `sh -c`. */
  shell: string;
  /** Where the command came from: a `.shipgate.yaml` override or the detected adapter. */
  source: "config" | "adapter";
  /** Adapter name when `source === "adapter"`. */
  adapter?: string;
}

export interface StackAdapter {
  readonly name: string;
  /** Confidence that this stack applies to the repo: 0 = no match, higher = more specific. */
  detect(repoRoot: string): Promise<number>;
  /** Default command line for a kind, or null if this adapter provides no default. */
  command(kind: CommandKind, repoRoot: string): Promise<string | null>;
  /** Auto-fix command line for lint (e.g. eslint --fix, phpcbf), if any. */
  fixCommand?(repoRoot: string): Promise<string | null>;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = Record<string, unknown>>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolve the command for a step. Order (spec): (1) `.shipgate.yaml` override
 * always wins; (2) else the detected adapter's default; (3) else null → the step
 * skips with a clear "no command configured" finding rather than failing.
 */
export async function resolveCommand(
  kind: CommandKind,
  opts: { repoRoot: string; config: ShipgateConfig; adapter: StackAdapter | null },
): Promise<ResolvedCommand | null> {
  const override = opts.config.commands[kind];
  if (override && override.trim()) {
    return { kind, shell: override.trim(), source: "config" };
  }
  if (opts.adapter) {
    const fromAdapter = await opts.adapter.command(kind, opts.repoRoot);
    if (fromAdapter && fromAdapter.trim()) {
      return { kind, shell: fromAdapter.trim(), source: "adapter", adapter: opts.adapter.name };
    }
  }
  return null;
}

/** Resolve the auto-fix command from the adapter (config has no separate fixer field in v1). */
export async function resolveFixCommand(opts: {
  repoRoot: string;
  adapter: StackAdapter | null;
}): Promise<{ shell: string; adapter: string } | null> {
  const adapter = opts.adapter;
  if (adapter?.fixCommand) {
    const c = await adapter.fixCommand(opts.repoRoot);
    if (c && c.trim()) return { shell: c.trim(), adapter: adapter.name };
  }
  return null;
}
