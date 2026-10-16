import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { FormSheet } from '@/components/layout/form-sheet'
import { Modal } from '@/components/ui/modal'
import { PaymentDialog } from '@/features/billing/payment-dialog'

/**
 * A tap on the space outside a pop-up (a-popup-closes-when-you-tap-outside-it).
 *
 * jsdom lays nothing out, so every dialog's rectangle is pinned to a box in the
 * middle of a screen, and "outside" is any point that is not in it. A tap is a
 * `pointerdown` then a `click` at the same point, as a browser dispatches it.
 */

const PANEL = { left: 100, right: 300, top: 100, bottom: 300 }
const OUTSIDE = { clientX: 10, clientY: 10 }
const PADDING = { clientX: 105, clientY: 105 }

let now = 0

beforeEach(() => {
  now = 1_000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(HTMLDialogElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...PANEL,
    x: PANEL.left,
    y: PANEL.top,
    width: PANEL.right - PANEL.left,
    height: PANEL.bottom - PANEL.top,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A person's tap, aimed at an element. */
function tap(element: Element, point: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(element, point)
  fireEvent.click(element, point)
}

/** Time passes after the dialog opened, past the double-tap grace. */
function afterTheGrace() {
  now += 500
}

function renderOpen(props: Partial<ComponentProps<typeof Modal>> & { onClose: () => void }) {
  return render(
    <Modal open aria-label="Probe" className="p-4" {...props}>
      <label>
        Name
        <input />
      </label>
      <button type="button">Inside</button>
    </Modal>,
  )
}

describe('a tap outside a pop-up', () => {
  it('closes through onClose when a tap lands on the backdrop', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    afterTheGrace()

    tap(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a tap lands on the dialog’s own padding', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    afterTheGrace()

    tap(screen.getByRole('dialog'), PADDING)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a tap lands on a control inside', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    afterTheGrace()

    tap(screen.getByRole('button', { name: 'Inside' }), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a press starts inside and is released outside', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    afterTheGrace()

    // Selecting text in a field and letting go past the edge: the browser
    // reports the click on the nearest common ancestor, the dialog.
    fireEvent.pointerDown(screen.getByLabelText('Name'), PADDING)
    fireEvent.click(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on a click that no press on the backdrop began', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    afterTheGrace()

    // A keyboard- or script-initiated click carries no press and often no
    // position at all.
    fireEvent.click(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close from the second tap of a double-tap on the button that opened it', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    now += 120

    tap(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close from a press that began in the grace and was held past it', () => {
    const onClose = vi.fn()
    renderOpen({ onClose })
    now += 120

    // The finger came down on a backdrop that was not there when it aimed;
    // holding it there longer does not make it a decision.
    fireEvent.pointerDown(screen.getByRole('dialog'), OUTSIDE)
    afterTheGrace()
    fireEvent.click(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('forgets a press on the backdrop that never became a click when it opens again', () => {
    const onClose = vi.fn()
    const { rerender } = renderOpen({ onClose })
    afterTheGrace()

    // A press that turned into a scroll: the browser cancels it and sends no click.
    fireEvent.pointerDown(screen.getByRole('dialog'), OUTSIDE)
    const again = (open: boolean) => (
      <Modal open={open} aria-label="Probe" className="p-4" onClose={onClose}>
        <button type="button">Inside</button>
      </Modal>
    )
    rerender(again(false))
    rerender(again(true))
    afterTheGrace()
    onClose.mockClear()

    // A click the dialog never saw pressed, on its own, closes nothing.
    fireEvent.click(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when the dialog asks not to be dismissed this way', () => {
    const onClose = vi.fn()
    renderOpen({ onClose, dismissOnOutsideTap: false })
    afterTheGrace()

    tap(screen.getByRole('dialog'), OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when onClose declines, as a pop-up that is saving does', () => {
    renderOpen({ onClose: () => undefined })
    afterTheGrace()

    tap(screen.getByRole('dialog'), OUTSIDE)

    // Closed natively, the element would shut while the component still
    // believed it was open. `onClose` is the only way out.
    expect(screen.getByRole('dialog')).toHaveProperty('open', true)
  })

  it('closes only the pop-up on top when one is open over another', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <Modal open aria-label="Outer" onClose={outer}>
        <Modal open aria-label="Inner" onClose={inner}>
          <button type="button">Deep</button>
        </Modal>
      </Modal>,
    )
    afterTheGrace()

    tap(screen.getByRole('dialog', { name: 'Inner' }), OUTSIDE)

    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  describe('a confirmation that is busy', () => {
    function renderConfirm(busy: boolean, onClose: () => void) {
      render(
        <ConfirmDialog
          open
          title="Remove it?"
          consequence="It goes."
          confirmLabel="Remove"
          busy={busy}
          onConfirm={() => undefined}
          onClose={onClose}
        />,
      )
      afterTheGrace()
    }

    it('ignores a tap on the backdrop while its request runs', () => {
      const onClose = vi.fn()
      renderConfirm(true, onClose)

      tap(screen.getByRole('dialog', { name: 'Remove it?' }), OUTSIDE)

      expect(onClose).not.toHaveBeenCalled()
    })

    it('closes on a tap on the backdrop once idle', () => {
      const onClose = vi.fn()
      renderConfirm(false, onClose)

      tap(screen.getByRole('dialog', { name: 'Remove it?' }), OUTSIDE)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('a sheet that is saving', () => {
    function renderSheet(busy: boolean, onClose: () => void) {
      render(
        <FormSheet open title="Count & Collect" busy={busy} onClose={onClose}>
          <input aria-label="Counted" />
        </FormSheet>,
      )
      afterTheGrace()
    }

    it('ignores a tap on the backdrop while its save runs', () => {
      const onClose = vi.fn()
      renderSheet(true, onClose)

      tap(screen.getByRole('dialog', { name: 'Count & Collect' }), OUTSIDE)

      expect(onClose).not.toHaveBeenCalled()
    })

    it('closes on a tap on the backdrop once idle, as Close does', () => {
      const onClose = vi.fn()
      renderSheet(false, onClose)

      tap(screen.getByRole('dialog', { name: 'Count & Collect' }), OUTSIDE)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('the payment dialog', () => {
    function renderPayment(busy: boolean, onClose: () => void) {
      render(
        <PaymentDialog
          open
          totalPaise={25_000}
          busy={busy}
          onClose={onClose}
          onConfirm={() => undefined}
        />,
      )
      afterTheGrace()
    }

    it('ignores a tap on the backdrop while the payment is being taken', () => {
      const onClose = vi.fn()
      renderPayment(true, onClose)

      tap(screen.getByRole('dialog', { name: 'Record payment' }), OUTSIDE)

      expect(onClose).not.toHaveBeenCalled()
    })

    it('closes on a tap on the backdrop while idle, as Back does', () => {
      const onClose = vi.fn()
      renderPayment(false, onClose)

      tap(screen.getByRole('dialog', { name: 'Record payment' }), OUTSIDE)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
