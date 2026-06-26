import type { StackAdapter } from "./adapter.js";
import { WordPressAdapter } from "./wordpress.js";
import { NodeAdapter } from "./node.js";
import { GenericAdapter } from "./generic.js";

/**
 * Registry order also acts as the tie-break for equal detection scores: more
 * specific stacks first, generic last (Array.prototype.sort is stable).
 */
export const ADAPTERS: StackAdapter[] = [new WordPressAdapter(), new NodeAdapter(), new GenericAdapter()];

export interface Detection {
  adapter: StackAdapter;
  score: number;
}

/** All matching adapters (score > 0), most specific first. */
export async function detectStacks(repoRoot: string, adapters: StackAdapter[] = ADAPTERS): Promise<Detection[]> {
  const scored = await Promise.all(
    adapters.map(async (adapter) => ({ adapter, score: await adapter.detect(repoRoot) })),
  );
  return scored.filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
}

/** The single best-match adapter (generic is the guaranteed fallback), or null if none. */
export async function pickAdapter(repoRoot: string, adapters?: StackAdapter[]): Promise<StackAdapter | null> {
  const detected = await detectStacks(repoRoot, adapters);
  return detected.length > 0 ? detected[0]!.adapter : null;
}
