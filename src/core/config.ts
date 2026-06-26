import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Resolved shipgate configuration. A `.shipgate.yaml` override always wins over
 * the auto-detected stack defaults (resolved elsewhere); this module only owns
 * the file + explicit-flag layers. Arrays REPLACE on merge (if you set
 * `integrationBranches`, you mean exactly that list); objects merge per-key.
 */
export interface ShipgateConfig {
  commands: { test?: string; lint?: string; format?: string };
  base: {
    /** Ordered glob→branch rules; first match wins in base resolution. */
    rules: Array<{ when: string; use: string }>;
    integrationBranches: string[];
    releaseGlobs: string[];
  };
  /** Where `push` sends the run branch. A fork URL may differ from the PR-base repo. */
  push: { remote?: string; url?: string };
  source: "default" | "file";
  configPath?: string;
}

export const DEFAULT_CONFIG: Omit<ShipgateConfig, "source" | "configPath"> = {
  commands: {},
  base: {
    rules: [],
    integrationBranches: ["main", "master", "develop"],
    releaseGlobs: ["release/*"],
  },
  push: {},
};

const CONFIG_FILENAMES = [".shipgate.yaml", ".shipgate.yml"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string"); // keep only strings
}

/** Extract the known shape from arbitrary parsed YAML, ignoring unknown keys. */
export function parseConfigObject(raw: unknown): Partial<ShipgateConfig> {
  if (!isRecord(raw)) return {};
  const out: Partial<ShipgateConfig> = {};

  if (isRecord(raw.commands)) {
    const c: ShipgateConfig["commands"] = {};
    for (const k of ["test", "lint", "format"] as const) {
      if (typeof raw.commands[k] === "string") c[k] = raw.commands[k];
    }
    out.commands = c;
  }

  if (isRecord(raw.base)) {
    const base: Partial<ShipgateConfig["base"]> = {};
    if (Array.isArray(raw.base.rules)) {
      base.rules = raw.base.rules
        .filter(isRecord)
        .filter((r) => typeof r.when === "string" && typeof r.use === "string")
        .map((r) => ({ when: r.when as string, use: r.use as string }));
    }
    const ib = stringArray(raw.base.integrationBranches);
    if (ib) base.integrationBranches = ib;
    const rg = stringArray(raw.base.releaseGlobs);
    if (rg) base.releaseGlobs = rg;
    out.base = base as ShipgateConfig["base"];
  }

  if (isRecord(raw.push)) {
    const push: ShipgateConfig["push"] = {};
    if (typeof raw.push.remote === "string") push.remote = raw.push.remote;
    if (typeof raw.push.url === "string") push.url = raw.push.url;
    out.push = push;
  }

  return out;
}

/** Merge `override` onto `base`: objects per-key, arrays replace wholesale. */
function merge(
  base: Omit<ShipgateConfig, "source" | "configPath">,
  override: Partial<ShipgateConfig> | undefined,
): Omit<ShipgateConfig, "source" | "configPath"> {
  return {
    commands: { ...base.commands, ...override?.commands },
    base: {
      rules: override?.base?.rules ?? base.base.rules,
      integrationBranches: override?.base?.integrationBranches ?? base.base.integrationBranches,
      releaseGlobs: override?.base?.releaseGlobs ?? base.base.releaseGlobs,
    },
    push: { ...base.push, ...override?.push },
  };
}

async function readConfigFile(cwd: string): Promise<{ path: string; raw: unknown } | null> {
  for (const name of CONFIG_FILENAMES) {
    const path = join(cwd, name);
    try {
      const text = await readFile(path, "utf8");
      return { path, raw: parseYaml(text) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`failed to read ${path}: ${(err as Error).message}`);
    }
  }
  return null;
}

/**
 * Load + merge configuration. Precedence (lowest→highest): built-in defaults,
 * `.shipgate.yaml`, then `explicit` (e.g. CLI flags). Pure aside from the file
 * read: takes `cwd`, returns the resolved config.
 */
export async function loadConfig(opts: {
  cwd: string;
  explicit?: Partial<ShipgateConfig>;
}): Promise<ShipgateConfig> {
  const file = await readConfigFile(opts.cwd);
  const fromFile = file ? parseConfigObject(file.raw) : undefined;

  let merged = merge(DEFAULT_CONFIG, fromFile);
  merged = merge(merged, opts.explicit);

  return {
    ...merged,
    source: file ? "file" : "default",
    ...(file ? { configPath: file.path } : {}),
  };
}
