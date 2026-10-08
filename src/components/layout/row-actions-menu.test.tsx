import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { isInsideWindow, layOutAnchoredMenu } from '@/test/anchored-layout'

import { RowActionsMenu } from './row-actions-menu'

const PANEL = { width: 160, height: 50 }
const isRowTrigger = (element: Element) => element.tagName === 'DETAILS'

describe('RowActionsMenu', () => {
  it('keeps its actions hidden behind the trigger until opened', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <RowActionsMenu
        label="Actions for Demo Person"
        actions={[{ label: 'New code', onSelect }]}
      />,
    )

    expect(screen.queryByRole('button', { name: 'New code' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))
    await user.click(screen.getByRole('button', { name: 'New code' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'New code' })).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()

    render(
      <RowActionsMenu
        label="Actions for Demo Person"
        actions={[{ label: 'Edit', onSelect: () => {} }]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Actions for Demo Person' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('disables an action without dropping it from the menu', async () => {
    const user = userEvent.setup()

    render(
      <RowActionsMenu
        label="Actions for Demo Person"
        actions={[{ label: 'Deactivate', onSelect: () => {}, disabled: true }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled()
  })

  it("opens inward from the trigger's left edge when start-aligned", async () => {
    const user = userEvent.setup()
    const layout = layOutAnchoredMenu({
      isTrigger: isRowTrigger,
      trigger: { top: 48, left: 48, width: 32, height: 32 },
      panel: PANEL,
    })

    render(
      <RowActionsMenu
        align="start"
        label="Actions for Demo Person"
        actions={[{ label: 'Edit', onSelect: () => {} }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))

    const panel = screen.getByRole('button', { name: 'Edit' }).closest('div[style]')
    expect(panel).toHaveStyle({ left: '48px', top: '84px' })
    expect(panel).not.toHaveStyle({ right: `${window.innerWidth - 80}px` })

    layout.mockRestore()
  })

  it('opens above its trigger, on screen, when the row is at the foot of the window', async () => {
    const user = userEvent.setup()
    const top = window.innerHeight - 40
    const layout = layOutAnchoredMenu({
      isTrigger: isRowTrigger,
      trigger: { top, left: 600, width: 32, height: 32 },
      panel: PANEL,
    })

    render(
      <RowActionsMenu
        label="Actions for Demo Person"
        actions={[{ label: 'Edit', onSelect: () => {} }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))

    const panel = screen.getByRole('button', { name: 'Edit' }).closest('div[style]')!
    expect(panel.getBoundingClientRect().bottom).toBe(top - 4)
    expect(isInsideWindow(panel)).toBe(true)

    layout.mockRestore()
  })

  it("opens above a row that sits just over the phone's bottom bar", async () => {
    const user = userEvent.setup()
    const barTop = window.innerHeight - 130
    const top = barTop - 50
    const layout = layOutAnchoredMenu({
      isTrigger: isRowTrigger,
      trigger: { top, left: 600, width: 32, height: 32 },
      panel: PANEL,
      others: (element) =>
        element.getAttribute('data-window-edge') === 'bottom'
          ? { top: barTop, left: 0, width: window.innerWidth, height: 130 }
          : undefined,
    })

    render(
      <>
        <RowActionsMenu
          label="Actions for Demo Person"
          actions={[{ label: 'Edit', onSelect: () => {} }]}
        />
        <nav data-window-edge="bottom" />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))

    // Below would have fitted the window and gone over the bar.
    const panel = screen.getByRole('button', { name: 'Edit' }).closest('div[style]')!
    expect(panel.getBoundingClientRect().bottom).toBe(top - 4)

    layout.mockRestore()
  })
})
