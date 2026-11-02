import type { AttendanceTally } from './attendance-record'

/** A span of days, counted: the line Home shows about the month so far. */
export function TallySummary({ tally }: { tally: AttendanceTally }) {
  const cells: { label: string; value: number; testId: string; warn?: boolean }[] = [
    { label: 'Present', value: tally.present, testId: 'tally-present' },
    { label: 'Late', value: tally.late, testId: 'tally-late', warn: tally.late > 0 },
    { label: 'Absent', value: tally.absent, testId: 'tally-absent' },
    { label: 'Waiting', value: tally.waiting, testId: 'tally-waiting', warn: tally.waiting > 0 },
  ]

  return (
    <dl
      data-testid="attendance-tally"
      className="mb-3 grid grid-cols-4 gap-2 rounded-xl border border-border bg-surface p-2 text-center"
    >
      {cells.map((cell) => (
        <div key={cell.label}>
          <dd
            data-testid={cell.testId}
            className={
              cell.warn ? 'text-lg font-bold text-warning' : 'text-lg font-bold text-content'
            }
          >
            {cell.value}
          </dd>
          <dt className="text-xs text-content-muted">{cell.label}</dt>
        </div>
      ))}
    </dl>
  )
}
