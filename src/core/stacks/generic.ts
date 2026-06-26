import type { StackAdapter } from "./adapter.js";

/**
 * Fallback stack: always matches at the lowest confidence, and provides no
 * default commands. Any unanticipated toolchain works by configuring the three
 * commands in `.shipgate.yaml`; otherwise the steps skip cleanly.
 */
export class GenericAdapter implements StackAdapter {
  readonly name = "generic";

  async detect(): Promise<number> {
    return 1;
  }

  async command(): Promise<string | null> {
    return null;
  }
}
