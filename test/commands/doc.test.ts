import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as doc from "../../src/commands/doc.js";
import { createFixture, type GitFixture } from "../helpers/git-fixture.js";

const RUN = "shipgate/run-testrun01";

/** Build develop (with optional changelog) + a run branch off it. */
async function setup(fx: GitFixture, changelog?: string) {
  await fx.branch("develop", "main");
  await fx.checkout("develop");
  fx.write("src/index.ts", "export const v = 1\n");
  if (changelog !== undefined) fx.write("CHANGELOG.md", changelog);
  await fx.commitAll("develop base");
  await fx.push("develop");
  await fx.branch(RUN, "develop");
  await fx.checkout(RUN);
}

describe("doc command", () => {
  let fx: GitFixture;
  beforeEach(async () => {
    fx = await createFixture();
  });
  afterEach(() => fx.cleanup());

  it("applies a safe changelog bullet under Unreleased and reports the API change", async () => {
    await setup(fx, "# Changelog\n\n## [Unreleased]\n\n");
    fx.write("src/api.ts", "export function foo() {\n  return 1;\n}\n");
    await fx.commitAll("add foo");

    const r = await doc.run({ repo: fx.repo, runBranch: RUN, base: "develop", intent: "Add foo API" });
    expect(r.status).toBe("passed");
    expect(r.data).toMatchObject({ applied: [{ type: "changelog-entry", file: "CHANGELOG.md" }], changelogChanged: false });
    expect((r.data as { apiChanges: unknown[] }).apiChanges).toContainEqual({ file: "src/api.ts", symbol: "foo", kind: "added" });
    expect(readFileSync(join(fx.repo, "CHANGELOG.md"), "utf8")).toContain("- Add foo API");
  });

  it("reports a gap (no auto-fix) when no changelog file exists", async () => {
    await setup(fx);
    fx.write("src/api.ts", "export function bar() {}\n");
    await fx.commitAll("add bar");

    const r = await doc.run({ repo: fx.repo, runBranch: RUN, base: "develop" });
    expect(r.status).toBe("passed"); // only informational findings
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("doc.no-changelog");
    expect(ids).toContain("doc.api-surface");
  });

  it("does not flag a gap when the changelog was already updated in the diff", async () => {
    await setup(fx, "# Changelog\n\n## [Unreleased]\n\n");
    fx.write("src/api.ts", "export function baz() {}\n");
    fx.write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n- baz\n\n");
    await fx.commitAll("add baz + changelog");

    const r = await doc.run({ repo: fx.repo, runBranch: RUN, base: "develop" });
    expect(r.status).toBe("passed");
    expect(r.data).toMatchObject({ changelogChanged: true, applied: [] });
  });

  it("flags an auto-fix gap when the changelog has no Unreleased section", async () => {
    await setup(fx, "# Changelog\n\n## v1.0.0\n- initial\n");
    fx.write("src/api.ts", "export function qux() {}\n");
    await fx.commitAll("add qux");

    const r = await doc.run({ repo: fx.repo, runBranch: RUN, base: "develop" });
    expect(r.status).toBe("findings");
    expect(r.findings[0]).toMatchObject({ id: "doc.changelog-gap", action: "auto-fix" });
  });

  it("skips when there are no changes", async () => {
    await setup(fx, "# Changelog\n\n## [Unreleased]\n\n");
    const r = await doc.run({ repo: fx.repo, runBranch: RUN, base: "develop" });
    expect(r.status).toBe("skipped");
    expect(r.findings[0]?.id).toBe("doc.no-changes");
  });
});
