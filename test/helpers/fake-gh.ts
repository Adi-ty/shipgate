import type { GhPort } from "../../src/ports/gh.js";

export interface FakeGh extends GhPort {
  /** Branches queried, in order — lets tests assert gh was/wasn't consulted. */
  readonly calls: string[];
}

/**
 * In-memory GhPort. `map[branch]` is the PR base ref (or null for "no PR").
 * Branches not in the map resolve to null. Touches no network by construction.
 * Pass `{ throwOn: branch }` to simulate `gh` being unavailable for a branch.
 */
export function fakeGh(map: Record<string, string | null> = {}, opts: { throwOn?: string } = {}): FakeGh {
  const calls: string[] = [];
  return {
    calls,
    async prViewBaseRef(_cwd, branch) {
      calls.push(branch);
      if (opts.throwOn === branch) {
        const err = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return branch in map ? map[branch]! : null;
    },
  };
}
