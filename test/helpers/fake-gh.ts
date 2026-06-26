import type { GhPort, PullRequest, PrCreateInput, PrEditInput, CiStatus } from "../../src/ports/gh.js";

export interface FakeGh extends GhPort {
  /** Operations performed, in order — lets tests assert what gh was asked to do. */
  readonly calls: string[];
  /** The in-memory PR store, keyed by head branch. */
  readonly prs: Map<string, PullRequest>;
}

export interface FakeGhOptions {
  /** Simulate `gh` being unavailable for a branch in prViewBaseRef (ENOENT). */
  throwOn?: string;
  /** Seed existing PRs, keyed by head branch. */
  prs?: Record<string, PullRequest>;
  /** Scripted CI statuses per head branch; each call shifts until the last sticks. */
  statuses?: Record<string, CiStatus[]>;
  /** Make prCreate throw, to exercise the failure path. */
  failCreate?: boolean;
}

/**
 * In-memory GhPort. `baseRefs[branch]` drives prViewBaseRef (for base resolution);
 * `opts.prs`/`opts.statuses` drive the PR + CI methods. Touches no network.
 */
export function fakeGh(baseRefs: Record<string, string | null> = {}, opts: FakeGhOptions = {}): FakeGh {
  const calls: string[] = [];
  const prs = new Map<string, PullRequest>(Object.entries(opts.prs ?? {}));
  const statuses: Record<string, CiStatus[]> = { ...opts.statuses };
  let nextNumber = 100;

  return {
    calls,
    prs,

    async prViewBaseRef(_cwd, branch) {
      calls.push(`viewBase:${branch}`);
      if (opts.throwOn === branch) {
        const err = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      if (branch in baseRefs) return baseRefs[branch] ?? null;
      return prs.get(branch)?.baseRefName ?? null;
    },

    async prView(_cwd, branch) {
      calls.push(`view:${branch}`);
      return prs.get(branch) ?? null;
    },

    async prCreate(_cwd, input: PrCreateInput) {
      calls.push(`create:${input.head}->${input.base}`);
      if (opts.failCreate) throw new Error("gh pr create failed");
      const number = nextNumber++;
      const url = `https://github.com/demo/repo/pull/${number}`;
      prs.set(input.head, { number, url, state: "OPEN", baseRefName: input.base, headRefName: input.head });
      return { number, url };
    },

    async prEdit(_cwd, branch, input: PrEditInput) {
      calls.push(`edit:${branch}`);
      const pr = prs.get(branch);
      if (!pr) throw new Error(`no PR for ${branch}`);
      if (input.base) pr.baseRefName = input.base;
      prs.set(branch, pr);
    },

    async prStatus(_cwd, branch) {
      calls.push(`status:${branch}`);
      const queue = statuses[branch];
      if (Array.isArray(queue) && queue.length > 0) {
        return queue.length > 1 ? queue.shift()! : queue[0]!;
      }
      return { state: "none", mergeable: null, checks: [] };
    },
  };
}
