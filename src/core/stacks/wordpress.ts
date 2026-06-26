import { join } from "node:path";
import { type StackAdapter, type CommandKind, pathExists, readJson, readText } from "./adapter.js";

interface ComposerJson {
  scripts?: Record<string, unknown>;
  require?: Record<string, string>;
  "require-dev"?: Record<string, string>;
}

/**
 * WordPress stack — the most complete adapter (the one we dogfood). It is NOT
 * special-cased into the core; it is simply the first PHP adapter. A plain PHP
 * project with no WordPress signal does not match here (it falls back to generic),
 * which is what keeps "PHP" from being conflated with "WordPress".
 *
 * Tooling preference, per kind: composer script → vendor/bin binary → global binary.
 */
export class WordPressAdapter implements StackAdapter {
  readonly name = "wordpress";

  async detect(repoRoot: string): Promise<number> {
    let score = 0;
    if (await this.hasThemeHeader(repoRoot)) score += 3; // classic theme: style.css "Theme Name:"
    if (await pathExists(join(repoRoot, "wp-content"))) score += 3; // a WP site
    if (await pathExists(join(repoRoot, "functions.php"))) score += 1;
    if (await this.composerMentionsWp(repoRoot)) score += 2; // wpcs / wordpress packages
    if (await this.phpcsMentionsWp(repoRoot)) score += 2; // phpcs.xml referencing WordPress
    return score;
  }

  private async composerScripts(repoRoot: string): Promise<Record<string, unknown>> {
    const composer = await readJson<ComposerJson>(join(repoRoot, "composer.json"));
    return composer?.scripts && typeof composer.scripts === "object" ? composer.scripts : {};
  }

  async command(kind: CommandKind, repoRoot: string): Promise<string | null> {
    const scripts = await this.composerScripts(repoRoot);
    switch (kind) {
      case "lint":
        if (scripts.lint) return "composer run lint";
        if (await pathExists(join(repoRoot, "vendor/bin/phpcs"))) return "vendor/bin/phpcs";
        if (await this.hasPhpcsConfig(repoRoot)) return "phpcs";
        return null;
      case "test":
        if (scripts.test) return "composer run test";
        if (await pathExists(join(repoRoot, "vendor/bin/phpunit"))) return "vendor/bin/phpunit";
        if (await this.hasPhpunitConfig(repoRoot)) return "phpunit";
        return null;
      case "format":
        if (scripts.format) return "composer run format";
        if (await pathExists(join(repoRoot, "vendor/bin/phpcbf"))) return "vendor/bin/phpcbf";
        if (await this.hasPhpcsConfig(repoRoot)) return "phpcbf";
        return null;
      default:
        return null;
    }
  }

  async fixCommand(repoRoot: string): Promise<string | null> {
    const scripts = await this.composerScripts(repoRoot);
    if (scripts["lint:fix"]) return "composer run lint:fix";
    if (scripts.format) return "composer run format";
    if (await pathExists(join(repoRoot, "vendor/bin/phpcbf"))) return "vendor/bin/phpcbf";
    if (await this.hasPhpcsConfig(repoRoot)) return "phpcbf";
    return null;
  }

  // ── detection helpers ─────────────────────────────────────────────────
  private async hasThemeHeader(repoRoot: string): Promise<boolean> {
    const css = await readText(join(repoRoot, "style.css"));
    return css !== null && /^\s*\*?\s*Theme Name\s*:/im.test(css);
  }

  private async composerMentionsWp(repoRoot: string): Promise<boolean> {
    const composer = await readJson<ComposerJson>(join(repoRoot, "composer.json"));
    if (!composer) return false;
    const deps = { ...composer.require, ...composer["require-dev"] };
    return Object.keys(deps).some((k) => /wp-coding-standards|vipwpcs|wordpress|johnpbloch\/wordpress/i.test(k));
  }

  private async phpcsMentionsWp(repoRoot: string): Promise<boolean> {
    for (const f of ["phpcs.xml", "phpcs.xml.dist", ".phpcs.xml", ".phpcs.xml.dist"]) {
      const xml = await readText(join(repoRoot, f));
      if (xml && /WordPress/i.test(xml)) return true;
    }
    return false;
  }

  private async hasPhpcsConfig(repoRoot: string): Promise<boolean> {
    for (const f of ["phpcs.xml", "phpcs.xml.dist", ".phpcs.xml", ".phpcs.xml.dist"]) {
      if (await pathExists(join(repoRoot, f))) return true;
    }
    return false;
  }

  private async hasPhpunitConfig(repoRoot: string): Promise<boolean> {
    for (const f of ["phpunit.xml", "phpunit.xml.dist"]) {
      if (await pathExists(join(repoRoot, f))) return true;
    }
    return false;
  }
}
