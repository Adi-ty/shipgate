import { exec, ok } from "../core/exec.js";

/**
 * The GitHub CLI surface the pipeline depends on — the single mockable network
 * seam. Tests inject a fake so no suite ever touches the network.
 */

export interface PullRequest {
  number: number;
  url: string;
  state: string; // OPEN | MERGED | CLOSED
  baseRefName: string;
  headRefName: string;
}

export interface PrCreateInput {
  base: string;
  head: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface PrEditInput {
  base?: string;
  title?: string;
  body?: string;
}

/** Rolled-up CI + mergeability state for a PR. */
export interface CiStatus {
  state: "pending" | "passing" | "failing" | "none";
  mergeable: string | null; // MERGEABLE | CONFLICTING | UNKNOWN
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
}

export interface GhPort {
  /** Base ref of an OPEN PR for `branch`, or null. (Used by base resolution.) */
  prViewBaseRef(cwd: string, branch: string): Promise<string | null>;
  /** Full PR record for `branch`, or null if there is none. */
  prView(cwd: string, branch: string): Promise<PullRequest | null>;
  prCreate(cwd: string, input: PrCreateInput): Promise<{ number: number; url: string }>;
  prEdit(cwd: string, branch: string, input: PrEditInput): Promise<void>;
  /** CI rollup + mergeability for a PR's head branch. */
  prStatus(cwd: string, branch: string): Promise<CiStatus>;
}

interface RollupEntry {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string; // CheckRun: QUEUED | IN_PROGRESS | COMPLETED
  conclusion?: string | null; // CheckRun: SUCCESS | FAILURE | ...
  state?: string; // StatusContext: SUCCESS | PENDING | FAILURE | ERROR
}

const FAIL = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PENDING = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"]);

function rollupToStatus(rollup: RollupEntry[], mergeable: string | null): CiStatus {
  const checks = rollup.map((e) => ({
    name: e.name ?? e.context ?? "check",
    status: e.status ?? e.state ?? "UNKNOWN",
    conclusion: e.conclusion ?? e.state ?? null,
  }));
  if (rollup.length === 0) return { state: "none", mergeable, checks };
  const signal = (e: RollupEntry) => e.conclusion ?? e.state ?? e.status ?? "";
  if (rollup.some((e) => FAIL.has(signal(e)))) return { state: "failing", mergeable, checks };
  if (rollup.some((e) => PENDING.has(e.status ?? "") || PENDING.has(e.state ?? "") || e.conclusion == null))
    return { state: "pending", mergeable, checks };
  return { state: "passing", mergeable, checks };
}

/** Concrete GhPort backed by the real `gh` binary. */
export const realGh: GhPort = {
  async prViewBaseRef(cwd, branch) {
    const r = await exec("gh", ["pr", "view", branch, "--json", "baseRefName", "-q", ".baseRefName"], { cwd });
    if (!ok(r)) return null;
    const base = r.stdout.trim();
    return base.length > 0 ? base : null;
  },

  async prView(cwd, branch) {
    const r = await exec(
      "gh",
      ["pr", "view", branch, "--json", "number,url,state,baseRefName,headRefName"],
      { cwd },
    );
    if (!ok(r)) return null;
    try {
      return JSON.parse(r.stdout) as PullRequest;
    } catch {
      return null;
    }
  },

  async prCreate(cwd, input) {
    const args = ["pr", "create", "--base", input.base, "--head", input.head, "--title", input.title, "--body", input.body];
    if (input.draft) args.push("--draft");
    const r = await exec("gh", args, { cwd });
    if (!ok(r)) throw new Error(`gh pr create failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
    const url = r.stdout.trim().split("\n").pop() ?? "";
    const m = url.match(/\/pull\/(\d+)/);
    return { number: m ? Number.parseInt(m[1]!, 10) : 0, url };
  },

  async prEdit(cwd, branch, input) {
    const args = ["pr", "edit", branch];
    if (input.base) args.push("--base", input.base);
    if (input.title) args.push("--title", input.title);
    if (input.body) args.push("--body", input.body);
    const r = await exec("gh", args, { cwd });
    if (!ok(r)) throw new Error(`gh pr edit failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
  },

  async prStatus(cwd, branch) {
    const r = await exec(
      "gh",
      ["pr", "view", branch, "--json", "statusCheckRollup,mergeable"],
      { cwd },
    );
    if (!ok(r)) return { state: "none", mergeable: null, checks: [] };
    try {
      const parsed = JSON.parse(r.stdout) as { statusCheckRollup?: RollupEntry[]; mergeable?: string };
      return rollupToStatus(parsed.statusCheckRollup ?? [], parsed.mergeable ?? null);
    } catch {
      return { state: "none", mergeable: null, checks: [] };
    }
  },
};
