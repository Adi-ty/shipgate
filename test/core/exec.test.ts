import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { exec, ok } from "../../src/core/exec.js";

const NODE = process.execPath;

describe("exec", () => {
  it("captures stdout and reports a clean exit", async () => {
    const r = await exec(NODE, ["-e", "process.stdout.write('hello')"]);
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(ok(r)).toBe(true);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures stderr separately", async () => {
    const r = await exec(NODE, ["-e", "process.stderr.write('boom')"]);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("boom");
    expect(r.exitCode).toBe(0);
  });

  it("passes through a non-zero exit code without throwing", async () => {
    const r = await exec(NODE, ["-e", "process.exit(3)"]);
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(ok(r)).toBe(false);
  });

  it("kills on timeout and flags timedOut", async () => {
    const r = await exec(NODE, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.signal).not.toBeNull();
    expect(ok(r)).toBe(false);
  });

  it("honors cwd", async () => {
    const dir = tmpdir();
    const r = await exec(NODE, ["-e", "process.stdout.write(process.cwd())"], { cwd: dir });
    // macOS tmpdir may be a symlink (/var → /private/var); compare by suffix.
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(dir.endsWith(r.stdout) || r.stdout.endsWith(dir.replace(/^\/private/, ""))).toBe(true);
  });

  it("merges env over process.env by default", async () => {
    const r = await exec(NODE, ["-e", "process.stdout.write(process.env.SHIPGATE_TEST || '')"], {
      env: { SHIPGATE_TEST: "bar" },
    });
    expect(r.stdout).toBe("bar");
  });

  it("writes input to stdin", async () => {
    const script = "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d))";
    const r = await exec(NODE, ["-e", script], { input: "piped-in" });
    expect(r.stdout).toBe("piped-in");
  });

  it("rejects when the binary cannot be spawned (ENOENT)", async () => {
    await expect(exec("shipgate-no-such-binary-xyz", [])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("truncates output that exceeds maxBuffer", async () => {
    const r = await exec(NODE, ["-e", "process.stdout.write('x'.repeat(1000))"], { maxBuffer: 100 });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(100);
  });
});
