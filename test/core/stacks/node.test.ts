import { describe, it, expect, afterEach } from "vitest";
import { NodeAdapter } from "../../../src/core/stacks/node.js";
import { createStackFixture, type StackFixture } from "../../helpers/stack-fixture.js";

describe("NodeAdapter", () => {
  let fx: StackFixture;
  const node = new NodeAdapter();
  afterEach(() => fx?.cleanup());

  it("resolves to the npm scripts that exist", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: { test: "vitest", lint: "eslint .", format: "prettier -w ." } });
    expect(await node.command("test", fx.dir)).toBe("npm test");
    expect(await node.command("lint", fx.dir)).toBe("npm run lint");
    expect(await node.command("format", fx.dir)).toBe("npm run format");
  });

  it("returns null for scripts that do not exist", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: { build: "tsc" } });
    expect(await node.command("test", fx.dir)).toBeNull();
    expect(await node.command("lint", fx.dir)).toBeNull();
  });

  it("prefers lint:fix, falls back to format, for the fix command", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: { "lint:fix": "eslint --fix ." } });
    expect(await node.fixCommand(fx.dir)).toBe("npm run lint:fix");

    fx.cleanup();
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: { format: "prettier -w ." } });
    expect(await node.fixCommand(fx.dir)).toBe("npm run format");

    fx.cleanup();
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: {} });
    expect(await node.fixCommand(fx.dir)).toBeNull();
  });
});
