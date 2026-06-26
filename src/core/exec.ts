import { spawn } from "node:child_process";

/**
 * The single subprocess choke point for the entire package. Nothing else spawns.
 *
 * Contract: `exec` RESOLVES for any process that actually started — including
 * non-zero exits and timeouts. It REJECTS only when the process could not be
 * spawned at all (e.g. ENOENT). Callers decide what a given exit code means;
 * this wrapper never editorializes.
 */

export interface ExecOptions {
  cwd?: string;
  /** Extra env vars; merged over process.env unless `replaceEnv` is set. */
  env?: NodeJS.ProcessEnv;
  /** Replace process.env entirely with `env` instead of merging over it. */
  replaceEnv?: boolean;
  /** Kill the process after this many ms (SIGTERM, then SIGKILL after a grace). 0/undefined = no timeout. */
  timeoutMs?: number;
  /** Written to the child's stdin, then stdin is closed. */
  input?: string;
  /** Max bytes captured per stream before truncating + killing the process (default 10 MB). */
  maxBuffer?: number;
}

export interface ExecResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  /** null when the process was killed by a signal (incl. timeout). */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** present + true only when output exceeded maxBuffer and was cut off. */
  truncated?: boolean;
  durationMs: number;
}

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB per stream
const KILL_GRACE_MS = 2000;

export function exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const env = opts.replaceEnv ? opts.env : { ...process.env, ...opts.env };
  const start = performance.now();

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env, shell: false });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    };

    const capture = (which: "out" | "err") => (chunk: Buffer) => {
      const currentLen = which === "out" ? stdout.length : stderr.length;
      if (currentLen >= maxBuffer) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const remaining = maxBuffer - currentLen;
      if (text.length > remaining) {
        truncated = true;
        const slice = text.slice(0, remaining);
        if (which === "out") stdout += slice;
        else stderr += slice;
        // Overflow → terminate to avoid unbounded memory growth.
        child.kill("SIGKILL");
      } else if (which === "out") {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    child.stdout?.on("data", capture("out"));
    child.stderr?.on("data", capture("err"));

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        killTimer.unref();
      }, opts.timeoutMs);
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        command,
        args,
        stdout,
        stderr,
        exitCode: code,
        signal: signal ?? null,
        timedOut,
        ...(truncated ? { truncated: true } : {}),
        durationMs: Math.round(performance.now() - start),
      });
    });

    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

/** Sugar for git.ts-style call sites: succeeded with a clean exit and no timeout. */
export function ok(r: ExecResult): boolean {
  return r.exitCode === 0 && !r.timedOut;
}

/**
 * Run a full command line through `/bin/sh -c`. This is how user/adapter-provided
 * commands (e.g. "npm run lint", "vendor/bin/phpcs --standard=phpcs.xml") execute —
 * a missing binary surfaces as the shell's exit 127, not a spawn ENOENT.
 * Reuses the single `exec` choke point for timeout/buffer handling.
 */
export function execShell(commandLine: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return exec("/bin/sh", ["-c", commandLine], opts);
}
