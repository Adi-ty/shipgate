import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, ok, type ExecResult } from "../../src/core/exec.js";

/**
 * Builds throwaway git repos for exercising the real git porcelain. Each fixture
 * is a working repo plus a bare `origin` remote, so `refs/remotes/origin/*` are
 * populated (the base resolver reads remote refs). Identity + signing are set as
 * LOCAL config so both the fixture's own git calls and the package's realGit
 * (which inherits no special env) behave identically and hermetically.
 */
export interface GitFixture {
  /** Working repo path. */
  repo: string;
  /** Bare remote path. */
  origin: string;
  /** Deterministic fixed run id for collision-safe, repeatable naming. */
  runId: string;
  /** Run an arbitrary git command in the repo (throws on non-zero). */
  git(args: string[], cwd?: string): Promise<string>;
  /** Stage all + commit; returns the new HEAD sha. */
  commitAll(message: string): Promise<string>;
  /** Empty commit (handy for manufacturing commit-distance); returns HEAD sha. */
  emptyCommit(message: string): Promise<string>;
  /** Write a file (relative to repo) without committing. */
  write(relPath: string, content: string): void;
  /** Create branch `name` (optionally from a start point). */
  branch(name: string, from?: string): Promise<void>;
  /** Check out an existing branch/ref. */
  checkout(ref: string): Promise<void>;
  /** Push all local branches to origin (updates refs/remotes/origin/*). */
  pushAll(): Promise<void>;
  /** Push a single branch to origin. */
  push(branch: string): Promise<void>;
  /** Resolve a ref to its sha. */
  sha(ref: string): Promise<string>;
  cleanup(): void;
}

const HERMETIC_ENV: NodeJS.ProcessEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "shipgate test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "shipgate test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function run(cwd: string, args: string[]): Promise<ExecResult> {
  return exec("git", args, { cwd, env: HERMETIC_ENV });
}

async function runOrThrow(cwd: string, args: string[]): Promise<string> {
  const r = await run(cwd, args);
  if (!ok(r)) throw new Error(`git ${args.join(" ")} failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function createFixture(): Promise<GitFixture> {
  const base = mkdtempSync(join(tmpdir(), "shipgate-fixture-"));
  const repo = join(base, "repo");
  const origin = join(base, "origin.git");
  mkdirSync(repo, { recursive: true });

  // Bare remote.
  await runOrThrow(base, ["init", "--bare", "-b", "main", origin]);

  // Working repo with hermetic local config.
  await runOrThrow(repo, ["init", "-b", "main"]);
  await runOrThrow(repo, ["config", "user.name", "shipgate test"]);
  await runOrThrow(repo, ["config", "user.email", "test@example.com"]);
  await runOrThrow(repo, ["config", "commit.gpgsign", "false"]);
  await runOrThrow(repo, ["config", "core.autocrlf", "false"]);
  await runOrThrow(repo, ["remote", "add", "origin", origin]);

  // Initial commit on main.
  writeFileSync(join(repo, "README.md"), "# fixture\n");
  await runOrThrow(repo, ["add", "-A"]);
  await runOrThrow(repo, ["commit", "-m", "init"]);

  let fileCounter = 0;

  const fixture: GitFixture = {
    repo,
    origin,
    runId: "testrun01",
    async git(args, cwd = repo) {
      return runOrThrow(cwd, args);
    },
    async commitAll(message) {
      await runOrThrow(repo, ["add", "-A"]);
      await runOrThrow(repo, ["commit", "-m", message]);
      return runOrThrow(repo, ["rev-parse", "HEAD"]);
    },
    async emptyCommit(message) {
      // Unique-ish content via a counter keeps successive empty commits distinct shas.
      fileCounter += 1;
      await runOrThrow(repo, ["commit", "--allow-empty", "-m", `${message} #${fileCounter}`]);
      return runOrThrow(repo, ["rev-parse", "HEAD"]);
    },
    write(relPath, content) {
      writeFileSync(join(repo, relPath), content);
    },
    async branch(name, from) {
      await runOrThrow(repo, from ? ["branch", name, from] : ["branch", name]);
    },
    async checkout(ref) {
      await runOrThrow(repo, ["checkout", ref]);
    },
    async pushAll() {
      await runOrThrow(repo, ["push", "origin", "--all"]);
    },
    async push(branch) {
      await runOrThrow(repo, ["push", "origin", branch]);
    },
    async sha(ref) {
      return runOrThrow(repo, ["rev-parse", ref]);
    },
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };

  return fixture;
}
