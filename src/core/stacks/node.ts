import { join } from "node:path";
import { type StackAdapter, type CommandKind, pathExists, readJson } from "./adapter.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

/** Node stack: resolves to the package.json scripts that actually exist. */
export class NodeAdapter implements StackAdapter {
  readonly name = "node";

  async detect(repoRoot: string): Promise<number> {
    return (await pathExists(join(repoRoot, "package.json"))) ? 2 : 0;
  }

  private async scripts(repoRoot: string): Promise<Record<string, string>> {
    const pkg = await readJson<PackageJson>(join(repoRoot, "package.json"));
    return pkg?.scripts ?? {};
  }

  async command(kind: CommandKind, repoRoot: string): Promise<string | null> {
    const s = await this.scripts(repoRoot);
    switch (kind) {
      case "test":
        return s.test ? "npm test" : null;
      case "lint":
        return s.lint ? "npm run lint" : null;
      case "format":
        return s.format ? "npm run format" : null;
      default:
        return null;
    }
  }

  async fixCommand(repoRoot: string): Promise<string | null> {
    const s = await this.scripts(repoRoot);
    if (s["lint:fix"]) return "npm run lint:fix";
    if (s.format) return "npm run format";
    return null;
  }
}
