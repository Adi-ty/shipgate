import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/** A throwaway project directory for exercising stack detection/resolution/execution. */
export interface StackFixture {
  dir: string;
  /** Write a file relative to the fixture root, creating parent dirs. */
  write(relPath: string, content: string): void;
  /** Write a JSON file. */
  writeJson(relPath: string, value: unknown): void;
  cleanup(): void;
}

export function createStackFixture(): StackFixture {
  const dir = mkdtempSync(join(tmpdir(), "shipgate-stack-"));
  const write = (relPath: string, content: string) => {
    const p = join(dir, relPath);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  return {
    dir,
    write,
    writeJson: (relPath, value) => write(relPath, JSON.stringify(value, null, 2)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
