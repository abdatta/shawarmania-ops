import { csvCell } from '@/domain/sales-analytics'

export function shortDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Dates'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${value}T12:00:00+05:30`))
}
export function compactChange(current: number, previous: number) {
  if (!previous) return current ? 'New' : '—'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(0)}%`
}
export function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
