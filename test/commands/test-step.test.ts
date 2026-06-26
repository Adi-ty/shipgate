import { describe, it, expect, afterEach } from "vitest";
import * as test from "../../src/commands/test.js";
import { createStackFixture, type StackFixture } from "../helpers/stack-fixture.js";

describe("test command", () => {
  let fx: StackFixture;
  afterEach(() => fx?.cleanup());

  it("skips with a no-op finding when no test command is configured", async () => {
    fx = createStackFixture();
    const result = await test.run({ repo: fx.dir });
    expect(result.status).toBe("skipped");
    expect(result.findings[0]).toMatchObject({ id: "test.no-command", action: "no-op" });
  });

  it("passes when the configured test command exits 0", async () => {
    fx = createStackFixture();
    fx.write(".shipgate.yaml", "commands:\n  test: 'true'\n");
    const result = await test.run({ repo: fx.dir });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ command: "true", source: "config" });
  });

  it("reports auto-fix findings when tests fail", async () => {
    fx = createStackFixture();
    fx.write(".shipgate.yaml", "commands:\n  test: 'false'\n");
    const result = await test.run({ repo: fx.dir });
    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "test.failed", action: "auto-fix" });
  });

  it("fails distinctly when the test runner is not installed (exit 127)", async () => {
    fx = createStackFixture();
    fx.write(".shipgate.yaml", "commands:\n  test: shipgate-no-such-runner-xyz\n");
    const result = await test.run({ repo: fx.dir });
    expect(result.status).toBe("failed");
    expect(result.findings[0]).toMatchObject({ id: "test.command-not-found", action: "ask-user" });
  });

  it("REAL Node: runs npm test and passes", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { name: "fx", version: "1.0.0", scripts: { test: 'node -e "process.exit(0)"' } });
    const result = await test.run({ repo: fx.dir });
    expect(result.status).toBe("passed");
    expect(result.data).toMatchObject({ command: "npm test", source: "adapter", adapter: "node" });
  });

  it("REAL Node: npm test failure → auto-fix findings", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { name: "fx", version: "1.0.0", scripts: { test: 'node -e "process.exit(1)"' } });
    const result = await test.run({ repo: fx.dir });
    expect(result.status).toBe("findings");
    expect(result.findings[0]).toMatchObject({ id: "test.failed", action: "auto-fix" });
  });
});
