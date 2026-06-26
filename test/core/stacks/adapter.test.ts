import { describe, it, expect, afterEach } from "vitest";
import { resolveCommand } from "../../../src/core/stacks/adapter.js";
import { NodeAdapter } from "../../../src/core/stacks/node.js";
import { GenericAdapter } from "../../../src/core/stacks/generic.js";
import { loadConfig } from "../../../src/core/config.js";
import { createStackFixture, type StackFixture } from "../../helpers/stack-fixture.js";

describe("resolveCommand resolution order", () => {
  let fx: StackFixture;
  afterEach(() => fx?.cleanup());

  it("a .shipgate.yaml override always wins over the adapter", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: { lint: "eslint ." } });
    fx.write(".shipgate.yaml", "commands:\n  lint: my-custom-linter --strict\n");
    const config = await loadConfig({ cwd: fx.dir });

    const resolved = await resolveCommand("lint", { repoRoot: fx.dir, config, adapter: new NodeAdapter() });
    expect(resolved).toMatchObject({ shell: "my-custom-linter --strict", source: "config" });
  });

  it("falls back to the adapter default when there is no override", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { scripts: { lint: "eslint ." } });
    const config = await loadConfig({ cwd: fx.dir });

    const resolved = await resolveCommand("lint", { repoRoot: fx.dir, config, adapter: new NodeAdapter() });
    expect(resolved).toMatchObject({ shell: "npm run lint", source: "adapter", adapter: "node" });
  });

  it("returns null when neither config nor adapter provides a command", async () => {
    fx = createStackFixture();
    const config = await loadConfig({ cwd: fx.dir });
    expect(await resolveCommand("lint", { repoRoot: fx.dir, config, adapter: new GenericAdapter() })).toBeNull();
  });
});
