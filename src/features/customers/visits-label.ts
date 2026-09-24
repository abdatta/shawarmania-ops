/** One bill is one visit, so this is a count of bills. */
export function visitsLabel(visits: number): string {
  return visits === 1 ? '1 visit' : `${visits} visits`
}
