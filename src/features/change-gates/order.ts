import type { ChangeGateSummary } from '@/data-access/adapters'

/**
 * The gates in an order a reader can follow: every gate after the gates it is
 * dependent on, and otherwise in the order they came. A dependency the list does
 * not hold — retired, say — is ignored rather than holding its dependent back.
 */
export function inDependencyOrder(gates: readonly ChangeGateSummary[]): ChangeGateSummary[] {
  const byKey = new Map(gates.map((gate) => [gate.key, gate]))
  const placed = new Set<string>()
  const ordered: ChangeGateSummary[] = []
  const place = (gate: ChangeGateSummary, path: Set<string>) => {
    if (placed.has(gate.key) || path.has(gate.key)) return
    path.add(gate.key)
    for (const key of gate.dependsOn) {
      const dependency = byKey.get(key)
      if (dependency) place(dependency, path)
    }
    placed.add(gate.key)
    ordered.push(gate)
  }
  for (const gate of gates) place(gate, new Set())
  return ordered
}

/** Every gate that depends on this one, directly or through another, that is on. */
export function dependentsOn(
  key: string,
  gates: readonly ChangeGateSummary[],
): ChangeGateSummary[] {
  const found = new Map<string, ChangeGateSummary>()
  const pending = [key]
  while (pending.length > 0) {
    const next = pending.pop()!
    for (const gate of gates) {
      if (gate.dependsOn.includes(next) && !found.has(gate.key)) {
        found.set(gate.key, gate)
        pending.push(gate.key)
      }
    }
  }
  return [...found.values()].filter((gate) => gate.enabled)
}
