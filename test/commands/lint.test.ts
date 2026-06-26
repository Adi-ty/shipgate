import { describe, it, expect, afterEach } from "vitest";
import * as lint from "../../src/commands/lint.js";
import { createStackFixture, type StackFixture } from "../helpers/stack-fixture.js";

const MINIMAL_PHPCS = '<?xml version="1.0"?>\n<ruleset name="fixture">\n  <file>.</file>\n  <rule ref="Generic.PHP.DisallowShortOpenTag"/>\n</ruleset>\n';

describe("lint command", () => {
  let fx: StackFixture;
  afterEach(() => fx?.cleanup());

  it("skips with a no-op finding when no lint command is configured", async () => {
    fx = createStackFixture(); // empty → generic
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("skipped");
    expect(result.findings[0]).toMatchObject({ id: "lint.no-command", action: "no-op" });
    expect(result.data).toMatchObject({ command: null, source: "none", stack: "generic" });
  });

  it("passes when the configured command exits 0 (config override wins)", async () => {
    fx = createStackFixture();
    fx.write(".shipgate.yaml", "commands:\n  lint: 'true'\n");
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ command: "true", source: "config" });
  });

  it("reports auto-fix findings when the lint command exits non-zero", async () => {
    fx = createStackFixture();
    fx.write(".shipgate.yaml", "commands:\n  lint: 'false'\n");
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "lint.failed", action: "auto-fix", severity: "error" });
  });

  it("fails distinctly when the lint tool is not installed (exit 127)", async () => {
    fx = createStackFixture();
    fx.write(".shipgate.yaml", "commands:\n  lint: shipgate-no-such-linter-xyz\n");
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("failed");
    expect(result.findings[0]).toMatchObject({ id: "lint.command-not-found", action: "ask-user" });
  });

  it("REAL Node: runs npm run lint and passes", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { name: "fx", version: "1.0.0", scripts: { lint: 'node -e "process.exit(0)"' } });
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ command: "npm run lint", source: "adapter", adapter: "node" });
  });

  it("REAL Node: npm run lint failure → auto-fix findings", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { name: "fx", version: "1.0.0", scripts: { lint: 'node -e "process.exit(1)"' } });
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "lint.failed", action: "auto-fix" });
  });

  it("--fix runs the fix command first and records it", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", {
      name: "fx",
      version: "1.0.0",
      scripts: { "lint:fix": 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' },
    });
    const result = await lint.run({ repo: fx.dir, fix: true });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ fixApplied: true });
    expect((result.evidence as { fix: { command: string } }).fix.command).toBe("npm run lint:fix");
  });

  it("REAL WordPress: real phpcs flags a short-tag violation → findings", async () => {
    fx = createStackFixture();
    fx.write("style.css", "/*\nTheme Name: Fixture\n*/\n");
    fx.write("phpcs.xml", MINIMAL_PHPCS);
    fx.write("bad.php", "<?php\n?>\n<? echo 'short tag'; ?>\n");
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("findings");
    expect(result.data).toMatchObject({ command: "phpcs", source: "adapter", adapter: "wordpress" });
  });

  it("REAL WordPress: real phpcs passes a clean file", async () => {
    fx = createStackFixture();
    fx.write("style.css", "/*\nTheme Name: Fixture\n*/\n");
    fx.write("phpcs.xml", MINIMAL_PHPCS);
    fx.write("ok.php", "<?php\n\necho 'ok';\n");
    const result = await lint.run({ repo: fx.dir });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ adapter: "wordpress" });
  });
});
