import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { realGit } from "../core/git.js";
import { pathExists } from "../core/stacks/adapter.js";
import { finding, stepResult, type Finding, type StepResult } from "../core/findings.js";
import { resolveBaseRef } from "./shared.js";
import type { GitPort } from "../ports/git.js";

export interface DocOptions {
  repo?: string;
  runBranch?: string;
  base: string;
  remote?: string;
  /** Text for an auto-applied changelog bullet (e.g. the intent summary). */
  intent?: string;
}

export interface DocDeps {
  git?: GitPort;
}

const CHANGELOG_NAMES = ["CHANGELOG.md", "CHANGELOG", "CHANGELOG.txt", "CHANGES.md", "HISTORY.md"];

// Heuristic, multi-language public-API detectors (no stack-specific conventions in core).
const EXPORT_PATTERNS: RegExp[] = [
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/, // JS/TS
  /^(?:public\s+|final\s+|abstract\s+)*function\s+(\w+)/, // PHP
  /^(?:export\s+)?func\s+([A-Z]\w*)/, // Go (exported = capitalized)
  /^type\s+([A-Z]\w*)/, // Go exported type
  /^(?:def|class)\s+(\w+)/, // Python
];

interface ApiChange {
  file: string;
  symbol: string;
  kind: "added" | "removed";
}

function scanApiChanges(diff: string): ApiChange[] {
  const changes: ApiChange[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice("+++ b/".length);
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@") || line.startsWith("diff --git") || line.startsWith("index ")) {
      continue;
    }
    const sign = line[0];
    if (sign !== "+" && sign !== "-") continue;
    const content = line.slice(1).trim();
    for (const re of EXPORT_PATTERNS) {
      const m = content.match(re);
      if (m?.[1]) {
        changes.push({ file, symbol: m[1], kind: sign === "+" ? "added" : "removed" });
        break;
      }
    }
  }
  const seen = new Set<string>();
  return changes.filter((c) => {
    const key = `${c.file}:${c.symbol}:${c.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findChangelog(repoRoot: string): Promise<string | null> {
  for (const name of CHANGELOG_NAMES) {
    if (await pathExists(join(repoRoot, name))) return name;
  }
  return null;
}

const UNRELEASED = /^#{1,6}\s*\[?unreleased\]?/im;

/** Insert a bullet immediately after the Unreleased heading; returns null if no such heading. */
function appendUnreleasedBullet(text: string, bullet: string): string | null {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => UNRELEASED.test(l));
  if (idx === -1) return null;
  lines.splice(idx + 1, 0, `- ${bullet}`);
  return lines.join("\n");
}

/**
 * `shipgate doc` — generically detect doc/changelog gaps for the diff (public API
 * changes without a matching changelog entry), apply the safe update (a changelog
 * bullet under an existing Unreleased section), and report unresolved gaps. No
 * stack-specific doc conventions live here.
 */
export async function run(opts: DocOptions, deps: DocDeps = {}): Promise<StepResult> {
  const git = deps.git ?? realGit;
  const repoRoot = await git.showToplevel(opts.repo ?? process.cwd());
  const remote = opts.remote ?? "origin";
  const runBranch = opts.runBranch ?? "HEAD";

  const baseRef = await resolveBaseRef(git, repoRoot, remote, opts.base);
  if (!baseRef) {
    return stepResult({
      step: "doc",
      status: "failed",
      findings: [finding({ id: "doc.base-not-found", severity: "error", action: "ask-user", message: `Base '${opts.base}' not found on '${remote}' or locally.` })],
      data: { base: opts.base, runBranch },
    });
  }

  const range = `${baseRef}...${runBranch}`;
  const files = await git.diffFiles(repoRoot, range);
  if (files.length === 0) {
    return stepResult({
      step: "doc",
      status: "skipped",
      findings: [finding({ id: "doc.no-changes", severity: "info", action: "no-op", message: `No changes vs '${opts.base}'.` })],
      data: { base: opts.base, runBranch, filesChanged: 0 },
    });
  }

  const changelog = await findChangelog(repoRoot);
  const changelogChanged = changelog ? files.some((f) => f.file === changelog) : false;
  const sourceFiles = files.filter((f) => f.file !== changelog);
  const diff = await git.diffText(repoRoot, range);
  const apiChanges = scanApiChanges(diff);

  const findings: Finding[] = [];
  const applied: Array<{ type: string; file: string }> = [];

  if (sourceFiles.length > 0) {
    if (changelog) {
      if (!changelogChanged) {
        const text = await readFile(join(repoRoot, changelog), "utf8");
        const bullet = opts.intent?.trim() ? opts.intent.trim().split("\n")[0]!.slice(0, 120) : `Update from ${runBranch}`;
        const updated = appendUnreleasedBullet(text, bullet);
        if (updated !== null) {
          await writeFile(join(repoRoot, changelog), updated);
          applied.push({ type: "changelog-entry", file: changelog });
        } else {
          findings.push(finding({ id: "doc.changelog-gap", severity: "warning", action: "auto-fix", message: `${changelog} has no Unreleased section; add an entry for these changes.` }));
        }
      }
    } else {
      findings.push(finding({ id: "doc.no-changelog", severity: "info", action: "no-op", message: "No changelog file found; consider adding one for these changes." }));
    }

    if (apiChanges.length > 0) {
      findings.push(
        finding({
          id: "doc.api-surface",
          severity: "info",
          action: "no-op",
          message: `Public API changed (${apiChanges.length} symbol(s)); ensure docs cover them.`,
          data: { symbols: apiChanges },
        }),
      );
    }
  }

  const status = findings.some((f) => f.action !== "no-op") ? "findings" : "passed";

  return stepResult({
    step: "doc",
    status,
    findings,
    data: {
      base: opts.base,
      runBranch,
      filesChanged: files.length,
      sourceFiles: sourceFiles.map((f) => f.file),
      apiChanges,
      changelog: changelog ?? null,
      changelogChanged,
      applied,
    },
  });
}
