import { describe, it, expect, afterEach } from "vitest";
import { WordPressAdapter } from "../../../src/core/stacks/wordpress.js";
import { createStackFixture, type StackFixture } from "../../helpers/stack-fixture.js";

describe("WordPressAdapter", () => {
  let fx: StackFixture;
  const wp = new WordPressAdapter();
  afterEach(() => fx?.cleanup());

  it("prefers composer scripts when present", async () => {
    fx = createStackFixture();
    fx.write("style.css", "/*\nTheme Name: T\n*/\n");
    fx.writeJson("composer.json", { scripts: { lint: "phpcs", test: "phpunit", format: "phpcbf" } });
    expect(await wp.command("lint", fx.dir)).toBe("composer run lint");
    expect(await wp.command("test", fx.dir)).toBe("composer run test");
    expect(await wp.command("format", fx.dir)).toBe("composer run format");
  });

  it("falls back to vendor/bin binaries", async () => {
    fx = createStackFixture();
    fx.write("style.css", "/*\nTheme Name: T\n*/\n");
    fx.write("vendor/bin/phpcs", "#!/bin/sh\n");
    fx.write("vendor/bin/phpunit", "#!/bin/sh\n");
    expect(await wp.command("lint", fx.dir)).toBe("vendor/bin/phpcs");
    expect(await wp.command("test", fx.dir)).toBe("vendor/bin/phpunit");
  });

  it("falls back to global binaries when only config files exist", async () => {
    fx = createStackFixture();
    fx.write("phpcs.xml", '<?xml version="1.0"?>\n<ruleset><rule ref="WordPress"/></ruleset>\n');
    fx.write("phpunit.xml", "<phpunit/>\n");
    expect(await wp.command("lint", fx.dir)).toBe("phpcs");
    expect(await wp.command("test", fx.dir)).toBe("phpunit");
    expect(await wp.command("format", fx.dir)).toBe("phpcbf");
  });

  it("resolves a fix command from phpcs config", async () => {
    fx = createStackFixture();
    fx.write("phpcs.xml.dist", '<?xml version="1.0"?>\n<ruleset><rule ref="WordPress"/></ruleset>\n');
    expect(await wp.fixCommand(fx.dir)).toBe("phpcbf");
  });

  it("returns null commands when no PHP tooling is configured", async () => {
    fx = createStackFixture();
    fx.write("style.css", "/*\nTheme Name: T\n*/\n");
    expect(await wp.command("lint", fx.dir)).toBeNull();
    expect(await wp.command("test", fx.dir)).toBeNull();
  });
});
