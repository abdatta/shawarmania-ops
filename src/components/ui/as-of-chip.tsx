import { formatFreshness } from '@/domain'

/**
 * When a measured figure was last confirmed, as a chip beside its source chip.
 *
 * One component for all three surfaces that show a measured figure — the
 * statement, the notebook's day, the notebook's month — because a figure the
 * Ledger says was read an hour ago and the Notebook says was read yesterday is
 * worse than neither saying anything. It was three copies before this was
 * extracted, and the third was where the drift would have started.
 *
 * **Silent on a null**, which is a row whose freshness nothing recorded. A
 * fabricated stamp is the one wrong answer that looks like a reading.
 */
export function AsOfChip({ at, testId }: { at: string | null; testId: string }) {
  if (at === null) return null

  return (
    <span
      data-testid={testId}
      className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[11px] font-semibold text-content-muted"
      title={`Last confirmed: ${formatFreshness(at)}. A read that found these figures unchanged still counts, so this is when they were last checked rather than when they last moved.`}
    >
      {formatFreshness(at)}
    </span>
  )
}
