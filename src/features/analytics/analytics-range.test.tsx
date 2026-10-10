import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsRange } from './analytics-range'

function setup(from = '2026-10-04', to = '2026-10-10') {
  const onChange = vi.fn()
  const result = render(
    <AnalyticsRange from={from} to={to} today="2026-10-10" onChange={onChange} />,
  )
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Choose dates' }))
  const edit = (field: 'from' | 'to', value: string) =>
    fireEvent.change(screen.getByTestId(`analytics-${field}-day-picker`), { target: { value } })
  const date = (field: 'from' | 'to') => screen.getByTestId(`analytics-${field}-day-picker`)
  return { ...result, onChange, open, edit, date }
}

describe('analytics date choices', () => {
  it.each([
    [1, '2026-10-10', 'hour'],
    [7, '2026-10-04', 'day'],
    [30, '2026-09-11', 'day'],
  ])('%s days includes today and keeps exactly that many inclusive dates', (days, from, grain) => {
    const { onChange } = setup()
    fireEvent.click(
      screen.getByRole('button', { name: `Last ${days} ${days === 1 ? 'day' : 'days'}` }),
    )
    expect(onChange).toHaveBeenCalledWith({ from, to: '2026-10-10', grain })
  })
  it('recognises the inclusive preset and steps a previous range forward to today', () => {
    const { onChange } = setup('2026-09-27', '2026-10-03')
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-04', to: '2026-10-10' })
  })
  it('marks the default preset and stops future navigation', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()
  })
  it.each(['from', 'to'] as const)(
    'links repeated %s edits until the opposite endpoint is edited',
    (first) => {
      const { onChange, open, edit, date } = setup()
      const other = first === 'from' ? 'to' : 'from'
      open()
      edit(first, first === 'from' ? '2026-10-02' : '2026-10-08')
      expect(date('from')).toHaveValue('2026-10-02')
      expect(date('to')).toHaveValue('2026-10-08')
      edit(first, first === 'from' ? '2026-10-01' : '2026-10-07')
      expect(date('from')).toHaveValue('2026-10-01')
      expect(date('to')).toHaveValue('2026-10-07')
      edit(other, first === 'from' ? '2026-10-09' : '2026-10-02')
      edit(first, first === 'from' ? '2026-10-03' : '2026-10-10')
      expect(date('from')).toHaveValue(first === 'from' ? '2026-10-03' : '2026-10-02')
      expect(date('to')).toHaveValue(first === 'from' ? '2026-10-09' : '2026-10-10')
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        from: first === 'from' ? '2026-10-03' : '2026-10-02',
        to: first === 'from' ? '2026-10-09' : '2026-10-10',
      })
    },
  )
  it('cancels drafts, restores the applied range and resets linking on reopening', () => {
    const { open, edit, date, onChange } = setup()
    open()
    edit('from', '2026-10-02')
    edit('to', '2026-10-09')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onChange).not.toHaveBeenCalled()
    open()
    expect(date('from')).toHaveValue('2026-10-04')
    expect(date('to')).toHaveValue('2026-10-10')
    edit('to', '2026-10-08')
    expect(date('from')).toHaveValue('2026-10-02')
  })
  it('preserves a custom leap-boundary span without clamping a future end', () => {
    const { rerender, open, edit, date, onChange } = setup()
    rerender(
      <AnalyticsRange from="2024-02-28" to="2024-03-01" today="2026-10-10" onChange={onChange} />,
    )
    open()
    edit('from', '2026-10-10')
    expect(date('to')).toHaveValue('2026-10-12')
    expect(screen.getByRole('button', { name: 'Apply dates' })).toBeDisabled()
    edit('to', '2026-10-10')
    expect(date('from')).toHaveValue('2026-10-10')
    expect(screen.getByRole('button', { name: 'Apply dates' })).toBeEnabled()
    edit('from', '2026-01-01')
    expect(screen.getByRole('button', { name: 'Apply dates' })).toBeDisabled()
  })
  it('recovers invalid links to seven days ending today', () => {
    const { open, date } = setup('invalid', '2026-02-31')
    open()
    expect(date('from')).toHaveValue('2026-10-04')
    expect(date('to')).toHaveValue('2026-10-10')
  })
})
