import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { CounterActionError, type DataAdapters } from '@/data-access/adapters'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
} from '@/data-access/mock'
import { SessionContext } from '@/session/context'
import type { Role } from '@/session/session'
import { chooseOutlet, expectOutletChosen, outletChip } from '@/test/outlet-scope'
import { demoSessionFor } from '@/test/session'

import { DevicesSurface } from './devices-surface'

/**
 * The Tablets surface: what it says about hardware it cannot see, and what it
 * warns about before removing one.
 *
 * The interesting assertions here are all about **honesty rather than
 * capability**. Whether a manager may remove another outlet's tablet is the
 * database's answer and is proved in `supabase/tests/23_...sql`; what this file
 * proves is that a figure written by a tablet that stopped talking two days ago
 * is not presented as though it were current.
 */

/**
 * The switcher is single-select here since tablets-one-outlet-at-a-time, so this
 * file drives it with the same shared helpers every other single-outlet surface
 * uses: `chooseOutlet` moves the surface to an outlet rather than adding one to
 * a selection, and `expectOutletChosen` asserts both halves of the rule — the
 * chip reports itself pressed, and it cannot be cleared.
 */

function renderSurface(role: Role, adapters: DataAdapters) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={demoSessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>
          <DevicesSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('the Tablets surface', () => {
  it('derives one live-shift snapshot from the same effective tender as billing', async () => {
    const data = createDemoData()
    const adapters = createMockAdapters('super_admin', data)
    const shift = data.store.shifts.find(
      (candidate) => candidate.outlet_id === OUTLET_KALYANI_ID && candidate.ended_at === null,
    )!
    const corrected = data.store.bills.find(
      (bill) =>
        bill.counter_shift_id === shift.id &&
        bill.status === 'settled' &&
        data.store.billPayments.get(bill.id)?.some((payment) => payment.method === 'cash'),
    )!
    const totalPaise = corrected.total_paise

    // The demo store treats this map as its effective-allocation boundary. A
    // correction replaces the old tender here rather than adding a second one.
    data.store.billPayments.set(corrected.id, [{ method: 'upi', amountPaise: totalPaise }])

    const [snapshot] = await adapters.counter.readDeviceOperations([OUTLET_KALYANI_ID])
    const operations = snapshot!.operations!
    const effective = data.store.bills
      .filter((bill) => bill.counter_shift_id === shift.id && bill.status === 'settled')
      .flatMap((bill) => data.store.billPayments.get(bill.id) ?? [])
    const expectedCash = effective
      .filter((payment) => payment.method === 'cash')
      .reduce((sum, payment) => sum + payment.amountPaise, 0)
    const expectedUpi = effective
      .filter((payment) => payment.method === 'upi')
      .reduce((sum, payment) => sum + payment.amountPaise, 0)

    expect(operations.cashTotalPaise).toBe(expectedCash)
    expect(operations.upiTotalPaise).toBe(expectedUpi)
    expect(operations.drawerCashPaise).toBe(expectedCash)
    expect(operations.billCount).toBe(
      data.store.bills.filter((bill) => bill.counter_shift_id === shift.id).length,
    )
  })

  it('marks telemetry that has stopped moving rather than showing it as current', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)
    // Kanchrapara's tablet is the one that stopped talking in the demo data, so
    // the surface is moved to that outlet to have something stale to mark. One
    // outlet at a time since tablets-one-outlet-at-a-time: this replaces the
    // outlet being read rather than adding to it.
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)

    const rows = await screen.findAllByTestId('device-telemetry')
    const text = rows.map((row) => row.textContent ?? '').join(' ')

    // "Last reported", never "current": both figures are the tablet's own claim
    // about itself, and one that is switched off simply stops moving them.
    expect(text).toMatch(/Last reported/)
    // Kanchrapara's tablet has said nothing for two days in the demo data, so
    // there is something genuinely stale on screen to mark.
    expect(text).toMatch(/Out of touch/)
  })

  /**
   * The zero that must not read as an empty queue.
   *
   * A tablet's unresolved count is the tablet's own claim about itself, so one
   * that is switched off, offline or broken simply stops moving it. A zero from
   * hours ago therefore says nothing about whether that till has unsent money on
   * it -- and "0 unresolved" with no age beside it is exactly the sentence a
   * manager would act on.
   */
  it('never lets a stale zero read as an empty queue', async () => {
    // Kalyani's second counter is the demo's stale-zero till: it reported hours
    // ago, and reported nothing outstanding.
    const adapters = createMockAdapters('super_admin', createDemoData())

    renderSurface('super_admin', adapters)
    const rows = await screen.findAllByTestId('device-telemetry')
    const stale = rows.find((row) => /0 unresolved/.test(row.textContent ?? ''))!

    // The count is dated, and the card says the figures are old. Either alone
    // would be a zero somebody trusts.
    expect(stale).toHaveTextContent(/Last reported/)
    expect(stale).toHaveTextContent(/Out of touch/)
  })

  it('lists every tablet at an outlet, and offers another', async () => {
    const adapters = createMockAdapters('franchise_admin', createDemoData())
    renderSurface('franchise_admin', adapters)

    // Kalyani has two counters in the demo shop. The assertion here used to be
    // that a setup control is withheld once a tablet is standing, because one
    // active tablet per outlet was a database invariant. It is not one any more,
    // so the control is offered and it says it is offering another.
    expect(await screen.findAllByTestId('device-telemetry')).toHaveLength(2)
    expect(screen.getAllByText('Counter tablet').length).toBeGreaterThan(0)
    expect(screen.getByText('Takeaway counter')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /set up another tablet at Shawarmania Kalyani/i }),
    ).toBeInTheDocument()
  })

  /**
   * One outlet at a time, since tablets-one-outlet-at-a-time.
   *
   * The surface read several at once for six weeks, for a reason recorded on the
   * call site. What ended it is that an outlet now holds as many tablets as it
   * has tills, so several outlets meant outlet-then-tills-then-outlet-then-tills
   * and the reader scrolled past the shop they came for — and the cross-business
   * question that justified it is answered on the Outlets surface per outlet.
   * These four assert the reversal rather than leaving it as the absence of the
   * old behaviour.
   */
  it('lists only the chosen outlet, and does not repeat its name as a heading', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)

    // Kalyani's two tills, and neither of Kanchrapara's.
    expect(await screen.findAllByTestId('device-telemetry')).toHaveLength(2)
    await waitFor(() => expectOutletChosen(OUTLET_KALYANI_ID))
    expect(screen.queryByText('Kanchrapara counter')).not.toBeInTheDocument()

    // The chip that chose the outlet is directly above the list, so a heading
    // saying the same word is the second place it appears on one screen. The
    // chip itself still carries the name, which is why this looks for a heading
    // specifically rather than for the text.
    expect(screen.queryByRole('heading', { name: /Shawarmania Kalyani/i })).not.toBeInTheDocument()
  })

  it('replaces the outlet being read rather than adding to it', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)
    expect(await screen.findAllByTestId('device-telemetry')).toHaveLength(2)

    await chooseOutlet(OUTLET_KANCHRAPARA_ID)

    // Kanchrapara's one till, on its own — not three tills across two outlets.
    await waitFor(() => expect(screen.getAllByTestId('device-telemetry')).toHaveLength(1))
    expect(outletChip(OUTLET_KALYANI_ID)).toHaveAttribute('aria-pressed', 'false')
  })

  it('will not let the outlet being read be cleared', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)
    await screen.findAllByTestId('device-telemetry')

    // Disabled rather than swallowing the press: a surface scoped to nothing is
    // a blank screen asking a question nobody asked, and saying so before the
    // press beats saying it after.
    await waitFor(() => expectOutletChosen(OUTLET_KALYANI_ID))
    await user.click(outletChip(OUTLET_KALYANI_ID))
    expectOutletChosen(OUTLET_KALYANI_ID)
    expect(screen.getAllByTestId('device-telemetry')).toHaveLength(2)
  })

  it('offers a manager with one outlet no picker at all', async () => {
    const adapters = createMockAdapters('franchise_admin', createDemoData())
    renderSurface('franchise_admin', adapters)
    await screen.findAllByTestId('device-telemetry')

    expect(screen.queryByTestId('surface-outlet')).not.toBeInTheDocument()
    expect(screen.queryByTestId('surface-outlets')).not.toBeInTheDocument()
  })

  it('names the tablet on every action that acts on one', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)
    await screen.findAllByTestId('device-telemetry')

    // Two counters on screen, so a bare "Remove" would be an action somebody
    // performs on the wrong till.
    await user.click(screen.getByRole('button', { name: 'Remove Takeaway counter' }))

    expect(
      await screen.findByRole('dialog', { name: 'Remove Takeaway counter?' }),
    ).toBeInTheDocument()
  })

  it('prefills the setup properties and lets a manager rename during a live shift', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const adapters = createMockAdapters('franchise_admin', data)
    renderSurface('franchise_admin', adapters)

    await user.click(await screen.findByRole('button', { name: 'Edit Counter tablet' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit Counter tablet' })
    const name = within(sheet).getByLabelText('Name')
    expect(name).toHaveValue('Counter tablet')
    await waitFor(() => expect(name).toHaveFocus())
    expect(within(sheet).getByText('Shawarmania Kalyani')).toBeInTheDocument()
    expect(within(sheet).queryByRole('combobox', { name: 'Outlet' })).not.toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'Main counter')
    await user.click(within(sheet).getByRole('button', { name: 'Save tablet' }))

    expect(await screen.findByText('Main counter')).toBeInTheDocument()
    expect(data.counter.devices.find((device) => device.label === 'Main counter')?.outletId).toBe(
      OUTLET_KALYANI_ID,
    )
  })

  it('confirms an outlet move, preserves the session identity, and lets the tablet leave', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const device = data.counter.devices.find((candidate) => candidate.label === 'Takeaway counter')!
    const originalId = device.id
    const originalSetUpAt = device.setUpAt
    device.lastSeenAt = new Date().toISOString()
    const adapters = createMockAdapters('super_admin', data)
    renderSurface('super_admin', adapters)
    await waitFor(() => expectOutletChosen(OUTLET_KALYANI_ID))

    await user.click(await screen.findByRole('button', { name: 'Edit Takeaway counter' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit Takeaway counter' })
    await user.clear(within(sheet).getByLabelText('Name'))
    await user.type(within(sheet).getByLabelText('Name'), 'Kalyani Counter 2')
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Outlet' }),
      OUTLET_KANCHRAPARA_ID,
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save tablet' }))

    const confirm = await screen.findByRole('dialog', { name: 'Move Takeaway counter?' })
    expect(confirm).toHaveTextContent(/leave Shawarmania Kalyani/i)
    expect(confirm).toHaveTextContent(/join Shawarmania Kanchrapara/i)
    expect(confirm).toHaveTextContent(/keep the tablet online until it reloads/i)
    await user.click(within(confirm).getByRole('button', { name: 'Move tablet' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The tablet is at Kanchrapara now, and Kanchrapara is not the outlet being
    // read — so it leaves the list rather than being followed there. The
    // confirmation above is what said that would happen, before it did.
    expectOutletChosen(OUTLET_KALYANI_ID)
    await waitFor(() => expect(screen.queryByText('Kalyani Counter 2')).not.toBeInTheDocument())
    expect(screen.queryByText('Takeaway counter')).not.toBeInTheDocument()
    expect(device).toMatchObject({
      id: originalId,
      setUpAt: originalSetUpAt,
      outletId: OUTLET_KANCHRAPARA_ID,
      label: 'Kalyani Counter 2',
    })

    // It went somewhere rather than nowhere: the same tablet is at the outlet
    // the move named, under its new name, one tap away.
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    expect(await screen.findByText('Kalyani Counter 2')).toBeInTheDocument()
  })

  it('keeps the edit sheet open with an actionable refusal', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)

    await user.click(await screen.findByRole('button', { name: 'Edit Takeaway counter' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit Takeaway counter' })
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Outlet' }),
      OUTLET_KANCHRAPARA_ID,
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save tablet' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Move Takeaway counter?' })).getByRole(
        'button',
        { name: 'Move tablet' },
      ),
    )

    expect(await screen.findByRole('dialog', { name: 'Edit Takeaway counter' })).toBeInTheDocument()
    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(
      /report an empty queue within the last 30 minutes/i,
    )
  })

  it('names the outlet with no tablet, rather than saying "this outlet"', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    const devices = await adapters.counter.listDevices()
    for (const device of devices.filter((d) => d.outletId === OUTLET_KANCHRAPARA_ID)) {
      await adapters.counter.removeDevice(device.id)
    }

    renderSurface('super_admin', adapters)
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)

    // An outlet with no counter at all is the interesting answer this surface
    // carries, and an absence cannot be a row in a list of tills. The chosen
    // chip is a glance above, but this sentence is the one somebody acts on, so
    // it names the shop inside itself rather than saying "this outlet".
    expect(screen.queryByTestId('device-telemetry')).not.toBeInTheDocument()
    expect(
      await screen.findByText(/No tablet is set up at Shawarmania Kanchrapara yet/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Set up a tablet at Shawarmania Kanchrapara/i }),
    ).toBeInTheDocument()
  })

  it('says plainly when a tablet has nobody holding its counter', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)

    // Kalyani's second counter is unheld while its first has somebody on it, so
    // this asks for the first of several rather than the only one.
    const [unheld] = await screen.findAllByText('Nobody is at this counter.')
    const emptyCounter = unheld!.closest('section')!
    expect(within(emptyCounter).queryByText('Bills rung')).not.toBeInTheDocument()
    expect(within(emptyCounter).queryByText('Cash')).not.toBeInTheDocument()
  })

  it('keeps billing totals out of Tablets', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)
    // One card per tablet now, so this reads the one with somebody on it.
    const cards = await screen.findAllByTestId(/device-operations-/)
    const card = cards.find((candidate) =>
      /has held this counter since/i.test(candidate.textContent ?? ''),
    )!

    expect(card).toHaveTextContent(/has held this counter since/i)
    expect(within(card).queryByText('Bills rung')).not.toBeInTheDocument()
    expect(within(card).queryByText('Open orders waiting')).not.toBeInTheDocument()
    expect(within(card).queryByText('Cash')).not.toBeInTheDocument()
    expect(within(card).queryByText('UPI')).not.toBeInTheDocument()
    expect(within(card).queryByText('Drawer cash from these bills')).not.toBeInTheDocument()
  })

  it('keeps the newest outlet scope when an earlier read answers late', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    const firstScope = await adapters.counter.readDeviceOperations([OUTLET_KALYANI_ID])
    const secondScope = await adapters.counter.readDeviceOperations([OUTLET_KANCHRAPARA_ID])
    let resolveFirst!: (value: typeof firstScope) => void
    const delayedFirst = new Promise<typeof firstScope>((resolve) => {
      resolveFirst = resolve
    })
    const read = vi
      .fn<typeof adapters.counter.readDeviceOperations>()
      .mockImplementationOnce(() => delayedFirst)
      .mockResolvedValueOnce(secondScope)
    adapters.counter.readDeviceOperations = read

    renderSurface('super_admin', adapters)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Reading…' })).toBeDisabled()

    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    // Kanchrapara's one counter, and neither of Kalyani's two.
    await waitFor(() => expect(screen.getAllByTestId('device-telemetry')).toHaveLength(1))

    await act(async () => resolveFirst(firstScope))

    // The old Kalyani answer arrives after the reader has moved on. It is still
    // a coherent snapshot, but it is no longer the answer to the question the
    // surface is asking, so it may not publish Kalyani's tills under
    // Kanchrapara's name or claim Kanchrapara has none.
    expect(screen.getAllByTestId('device-telemetry')).toHaveLength(1)
    expect(
      screen.queryByText(/No tablet is set up at Shawarmania Kanchrapara/i),
    ).not.toBeInTheDocument()
  })

  it('shows a setup code once, and says that it is once', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const adapters = createMockAdapters('franchise_admin', data)
    // Nothing at this counter: the manager's outlet is empty, so setting one up
    // is the act available.
    for (const device of (await adapters.counter.listDevices()).filter(
      (candidate) => candidate.outletId === OUTLET_KALYANI_ID,
    )) {
      await adapters.counter.removeDevice(device.id)
    }

    renderSurface('franchise_admin', adapters)
    await user.click(await screen.findByRole('button', { name: /set up a tablet/i }))
    await user.type(screen.getByLabelText('What to call it'), 'Kalyani counter tablet')
    await user.click(screen.getByRole('button', { name: /generate a code/i }))

    const shown = await screen.findByText(/is not shown again/i)
    expect(shown).toBeInTheDocument()
    expect(screen.getByText('DEMO0-SETUP')).toBeInTheDocument()
    expect(shown).toHaveTextContent(/choose set up this tablet from sign in/i)
  })

  /**
   * What an owner actually reads when the backend is the problem.
   *
   * On 2026-08-11 this screen told somebody to check their internet connection
   * because `counter-devices` had never been deployed and the adapter read an
   * unrecognised failure as a transport one. The adapter classifies correctly
   * now, and this is the other half: that the sentence it produces survives the
   * surface's own catch and reaches the person, rather than being replaced by
   * the generic fallback beside it.
   */
  it('reports a backend fault as a fault to report, not as a bad connection', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin', createDemoData())
    for (const device of (await adapters.counter.listDevices()).filter(
      (candidate) => candidate.outletId === OUTLET_KALYANI_ID,
    )) {
      await adapters.counter.removeDevice(device.id)
    }
    adapters.counter.issueSetupCode = () => {
      throw new CounterActionError(
        'unsendable',
        'This app could not send that action. Nothing was recorded. Please report this.',
      )
    }

    renderSurface('franchise_admin', adapters)
    await user.click(await screen.findByRole('button', { name: /set up a tablet/i }))
    await user.type(screen.getByLabelText('What to call it'), 'Kalyani counter tablet')
    await user.click(screen.getByRole('button', { name: /generate a code/i }))

    const alert = await screen.findByTestId('devices-error')
    expect(alert).toHaveTextContent(/could not send that action/i)
    expect(alert).toHaveTextContent(/report this/i)
    // The two things it must never say: that the phone's connection is at
    // fault, and that waiting will help.
    expect(alert).not.toHaveTextContent(/internet connection/i)
    expect(alert).not.toHaveTextContent(/reach shawarmania/i)
    expect(alert).not.toHaveTextContent(/try again/i)
    // And no code was invented to go with the failure.
    expect(screen.queryByText(/is not shown again/i)).not.toBeInTheDocument()
  })

  it('names what would be left unsent before it removes a tablet', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)

    // Kanchrapara's tablet is the one carrying three unsent, which is the number
    // somebody will ask about afterwards, so the surface is moved to read that
    // outlet. One tap: Kalyani leaves on its own.
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    await screen.findAllByTestId('device-telemetry')
    await user.click(await screen.findByRole('button', { name: /^remove counter tablet$/i }))

    const consequence = await screen.findByText(/This is permanent/i)
    expect(consequence).toHaveTextContent(/3 unresolved/i)
    expect(consequence).toHaveTextContent(/nothing else can send it/i)
  })
})
