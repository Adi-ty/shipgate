import { describe, it, expect, afterEach } from "vitest";
import { pickAdapter, detectStacks } from "../../../src/core/stacks/detect.js";
import { createStackFixture, type StackFixture } from "../../helpers/stack-fixture.js";

describe("stack detection", () => {
  let fx: StackFixture;
  afterEach(() => fx?.cleanup());

  it("detects a Node project via package.json", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { name: "x", scripts: { test: "vitest" } });
    expect((await pickAdapter(fx.dir))?.name).toBe("node");
  });

  it("detects a WordPress theme via the style.css Theme Name header", async () => {
    fx = createStackFixture();
    fx.write("style.css", "/*\nTheme Name: My Theme\nVersion: 1.0\n*/\n");
    expect((await pickAdapter(fx.dir))?.name).toBe("wordpress");
  });

  it("detects WordPress via composer wpcs dependency + phpcs.xml", async () => {
    fx = createStackFixture();
    fx.writeJson("composer.json", { "require-dev": { "wp-coding-standards/wpcs": "^3.0" } });
    fx.write("phpcs.xml", '<?xml version="1.0"?>\n<ruleset><rule ref="WordPress"/></ruleset>\n');
    expect((await pickAdapter(fx.dir))?.name).toBe("wordpress");
  });

  it("a plain PHP project is NOT WordPress → falls back to generic", async () => {
    fx = createStackFixture();
    fx.writeJson("composer.json", { require: { "monolog/monolog": "^3.0" } });
    fx.write("index.php", "<?php\necho 1;\n");
    expect((await pickAdapter(fx.dir))?.name).toBe("generic");
  });

  it("a more specific stack wins over a generic one (WP theme that also has package.json)", async () => {
    fx = createStackFixture();
    fx.writeJson("package.json", { name: "theme-build", scripts: { build: "webpack" } });
    fx.write("style.css", "/*\nTheme Name: Hybrid\n*/\n");
    const detected = await detectStacks(fx.dir);
    expect(detected[0]?.adapter.name).toBe("wordpress");
    expect(detected.map((d) => d.adapter.name)).toContain("node");
  });

  it("an unknown/empty project falls back to generic", async () => {
    fx = createStackFixture();
    expect((await pickAdapter(fx.dir))?.name).toBe("generic");
  });
});
