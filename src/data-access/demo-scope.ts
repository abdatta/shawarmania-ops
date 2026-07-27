/**
 * The demo-scope tripwire (design D4, layer 2).
 *
 * The demo root layout marks the scope on mount and clears it on unmount;
 * getSupabaseClient() throws while it is marked. The route-prefix split
 * guarantees the demo and real trees never render in the same document, so a
 * module-level flag is sound — and a counter rather than a boolean keeps it
 * honest under StrictMode's deliberate double-mounting.
 *
 * This converts "someone later wires a real adapter into the demo tree by
 * mistake" from a silent data leak into an immediate crash in dev, test and
 * CI alike.
 */

let depth = 0

export function enterDemoScope(): void {
  depth += 1
}

export function exitDemoScope(): void {
  if (depth > 0) depth -= 1
}

export function isDemoScopeActive(): boolean {
  return depth > 0
}
