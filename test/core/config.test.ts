import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfigObject, DEFAULT_CONFIG } from "../../src/core/config.js";

describe("config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shipgate-config-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeConfig(yaml: string, name = ".shipgate.yaml") {
    writeFileSync(join(dir, name), yaml);
  }

  it("returns defaults when no config file is present", async () => {
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.source).toBe("default");
    expect(cfg.configPath).toBeUndefined();
    expect(cfg.commands).toEqual({});
    expect(cfg.base.integrationBranches).toEqual(["main", "master", "develop"]);
    expect(cfg.base.releaseGlobs).toEqual(["release/*"]);
    expect(cfg.base.rules).toEqual([]);
  });

  it("parses a config file and reports source=file", async () => {
    writeConfig(`
commands:
  test: npm test
  lint: npm run lint
base:
  integrationBranches: [main, develop, release/v2]
  rules:
    - when: "feature/v2-*"
      use: "release/v2"
`);
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.source).toBe("file");
    expect(cfg.configPath).toBe(join(dir, ".shipgate.yaml"));
    expect(cfg.commands.test).toBe("npm test");
    expect(cfg.commands.lint).toBe("npm run lint");
    expect(cfg.base.integrationBranches).toEqual(["main", "develop", "release/v2"]);
    expect(cfg.base.rules).toEqual([{ when: "feature/v2-*", use: "release/v2" }]);
  });

  it("file arrays REPLACE defaults rather than merging", async () => {
    writeConfig(`
base:
  integrationBranches: [trunk]
`);
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.base.integrationBranches).toEqual(["trunk"]);
    // releaseGlobs untouched → default
    expect(cfg.base.releaseGlobs).toEqual(["release/*"]);
  });

  it("explicit overrides win over the file", async () => {
    writeConfig(`
commands:
  test: from-file
base:
  integrationBranches: [main]
`);
    const cfg = await loadConfig({
      cwd: dir,
      explicit: { commands: { test: "from-explicit" }, base: { rules: [], integrationBranches: ["x"], releaseGlobs: ["rel/*"] } },
    });
    expect(cfg.commands.test).toBe("from-explicit");
    expect(cfg.base.integrationBranches).toEqual(["x"]);
    expect(cfg.base.releaseGlobs).toEqual(["rel/*"]);
    // still sourced from a file
    expect(cfg.source).toBe("file");
  });

  it("picks up the .yml extension too", async () => {
    writeConfig(`commands:\n  format: gofmt\n`, ".shipgate.yml");
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.source).toBe("file");
    expect(cfg.commands.format).toBe("gofmt");
  });

  it("parseConfigObject ignores unknown keys and malformed entries", () => {
    const parsed = parseConfigObject({
      commands: { test: "t", bogus: 5 },
      base: { rules: [{ when: "ok", use: "b" }, { when: 1, use: "x" }, "nope"], integrationBranches: ["a", 2] },
      extra: "ignored",
    });
    expect(parsed.commands).toEqual({ test: "t" });
    expect(parsed.base?.rules).toEqual([{ when: "ok", use: "b" }]);
    expect(parsed.base?.integrationBranches).toEqual(["a"]);
  });

  it("defaults object is not mutated across loads", async () => {
    const before = JSON.stringify(DEFAULT_CONFIG);
    writeConfig(`base:\n  integrationBranches: [only]\n`);
    await loadConfig({ cwd: dir });
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
  });
});
