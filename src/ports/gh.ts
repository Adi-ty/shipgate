import { exec, ok } from "../core/exec.js";

/**
 * The GitHub CLI surface the pipeline depends on — the single mockable network
 * seam. Tests inject a fake so no suite ever touches the network.
 */
export interface GhPort {
  /**
   * Base ref of an OPEN PR for `branch`, or null if there is none.
   * Throws only if `gh` itself cannot run (e.g. not installed); a missing PR or
   * an unauthenticated gh is an expected null, not an error.
   */
  prViewBaseRef(cwd: string, branch: string): Promise<string | null>;
}

/** Concrete GhPort backed by the real `gh` binary. */
export const realGh: GhPort = {
  async prViewBaseRef(cwd, branch) {
    // exec rejects (ENOENT) if gh is not installed → propagates to the caller,
    // which surfaces it distinctly from "no PR".
    const r = await exec("gh", ["pr", "view", branch, "--json", "baseRefName", "-q", ".baseRefName"], { cwd });
    if (!ok(r)) return null; // no PR / not authed / branch has no PR
    const base = r.stdout.trim();
    return base.length > 0 ? base : null;
  },
};
