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
import { demoSessionFor } from '@/test/session'

import { OutletTablets } from './outlet-tablets'

/**
 * An outlet's tablets, as a section of that outlet's page (outlets-one-at-a-time,
 * design D4). Ported from the Tablets page's own suite when that page was folded
 * in: the cases about choosing an outlet went with the picker, and everything
 * else stands.
 *
 * The interesting assertions are about **honesty rather than capability**.
 * Whether a manager may remove another outlet's tablet is the database's answer,
 * proved in `supabase/tests/23_...sql`; what this file proves is that a figure
 * written by a tablet that stopped talking two days ago is not presented as
 * though it were current.
 */

const NAMES: Record<string, string> = {
  [OUTLET_KALYANI_ID]: 'Shawarmania Kalyani',
  [OUTLET_KANCHRAPARA_ID]: 'Shawarmania Kanchrapara',
}

function section(outletId: string, role: Role) {
  const owner = role === 'super_admin'
  return (
    <OutletTablets
      outletId={outletId}
      outletName={NAMES[outletId]!}
      mayAdminister={owner || role === 'franchise_admin'}
      isOwner={owner}
    />
  )
}

function renderSection(role: Role, adapters: DataAdapters, outletId: string = OUTLET_KALYANI_ID) {
  const wrap = (id: string) => (
    <MemoryRouter>
      <SessionContext.Provider value={demoSessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>{section(id, role)}</AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>
  )
  const view = render(wrap(outletId))
  return { ...view, show: (id: string) => view.rerender(wrap(id)) }
}

async function removeEveryTabletAt(adapters: DataAdapters, outletId: string) {
  for (const device of (await adapters.counter.listDevices()).filter(
    (candidate) => candidate.outletId === outletId,
  )) {
    await adapters.counter.removeDevice(device.id)
  }
}

describe('an outlet’s tablets', () => {
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

  it('leads a tablet that has stopped reporting with that, not with its old figures', async () => {
    // Kanchrapara's tablet has said nothing for two days in the demo data.
    renderSection(
      'super_admin',
      createMockAdapters('super_admin', createDemoData()),
      OUTLET_KANCHRAPARA_ID,
    )

    const [line] = await screen.findAllByTestId('device-telemetry')
    expect(line).toHaveTextContent(/^Out of touch · last seen/)
    // The unsent count under it is still stated, as the figure it last reported.
    expect(screen.getByTestId('device-unsent')).toHaveTextContent(/3 unsent/)
  })

  /**
   * The zero that must not read as an empty queue.
   *
   * A tablet's unsent count is its own claim about itself, so one that is
   * switched off simply stops moving it. "All sent" from hours ago says nothing
   * about whether that till has unsent money on it, so the card leads with the
   * tablet being out of touch before it says anything else.
   */
  it('never lets a stale zero read as an empty queue', async () => {
    // Kalyani's second counter is the demo's stale-zero till.
    renderSection('super_admin', createMockAdapters('super_admin', createDemoData()))

    // One telemetry line and one unsent line per tablet, in the same order.
    const seen = await screen.findAllByTestId('device-telemetry')
    const unsent = screen.getAllByTestId('device-unsent')
    const stale = unsent.findIndex((line) => line.textContent === 'All sent')
    expect(stale).toBeGreaterThanOrEqual(0)
    expect(seen[stale]).toHaveTextContent(/^Out of touch/)
  })

  it('lists every tablet at the outlet, and offers another', async () => {
    renderSection('franchise_admin', createMockAdapters('franchise_admin', createDemoData()))

    expect(await screen.findAllByTestId('device-telemetry')).toHaveLength(2)
    expect(screen.getByText('Counter tablet')).toBeInTheDocument()
    expect(screen.getByText('Takeaway counter')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tablets · 2' })).toBeInTheDocument()
    expect(screen.getByTestId('add-tablet')).toHaveTextContent('Set up')
  })

  it('lists only its own outlet’s tablets', async () => {
    renderSection('super_admin', createMockAdapters('super_admin', createDemoData()))

    expect(await screen.findAllByTestId('device-telemetry')).toHaveLength(2)
    expect(screen.queryByText('Kanchrapara counter')).not.toBeInTheDocument()
  })

  it('offers nothing to administer to somebody who may not', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    render(
      <MemoryRouter>
        <SessionContext.Provider value={demoSessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <OutletTablets
              outletId={OUTLET_KALYANI_ID}
              outletName="Shawarmania Kalyani"
              mayAdminister={false}
              isOwner={false}
            />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )
    await screen.findAllByTestId('device-telemetry')

    expect(screen.queryByTestId('add-tablet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
  })

  it('says only the verb on a tablet’s buttons, and names the tablet to a screen reader', async () => {
    const user = userEvent.setup()
    renderSection('super_admin', createMockAdapters('super_admin', createDemoData()))
    await screen.findAllByTestId('device-telemetry')

    // The card's title names the tablet, so the button reads "Remove"; its
    // accessible name still says which, because a screen reader moving between
    // buttons hears the button and not the card it sits on.
    const remove = screen.getByRole('button', { name: 'Remove Takeaway counter' })
    expect(remove).toHaveTextContent(/^Remove$/)
    expect(screen.getByRole('button', { name: 'Edit Takeaway counter' })).toHaveTextContent(
      /^Edit$/,
    )

    await user.click(remove)
    expect(
      await screen.findByRole('dialog', { name: 'Remove Takeaway counter?' }),
    ).toBeInTheDocument()
  })

  it('prefills the setup properties and lets a manager rename during a live shift', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    renderSection('franchise_admin', createMockAdapters('franchise_admin', data))

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
    const { show } = renderSection('super_admin', createMockAdapters('super_admin', data))

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

    // The tablet is at Kanchrapara now, so it leaves Kalyani's page rather than
    // being followed there. The confirmation above is what said that would happen.
    await waitFor(() => expect(screen.queryByText('Kalyani Counter 2')).not.toBeInTheDocument())
    expect(screen.queryByText('Takeaway counter')).not.toBeInTheDocument()
    expect(device).toMatchObject({
      id: originalId,
      setUpAt: originalSetUpAt,
      outletId: OUTLET_KANCHRAPARA_ID,
      label: 'Kalyani Counter 2',
    })

    // It went somewhere rather than nowhere: the same tablet is on the page of
    // the outlet the move named, under its new name.
    show(OUTLET_KANCHRAPARA_ID)
    expect(await screen.findByText('Kalyani Counter 2')).toBeInTheDocument()
  })

  it('keeps the edit sheet open with an actionable refusal', async () => {
    const user = userEvent.setup()
    renderSection('super_admin', createMockAdapters('super_admin', createDemoData()))

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
    await removeEveryTabletAt(adapters, OUTLET_KANCHRAPARA_ID)

    renderSection('super_admin', adapters, OUTLET_KANCHRAPARA_ID)

    // An outlet with no counter at all is the interesting answer here, and an
    // absence cannot be a row in a list of tills. The sentence is the one
    // somebody acts on, so it names the shop inside itself.
    expect(
      await screen.findByText(/No tablet is set up at Shawarmania Kanchrapara yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('device-telemetry')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tablets' })).toBeInTheDocument()
    expect(screen.getByTestId('add-tablet')).toBeInTheDocument()
  })

  it('says plainly when a tablet has nobody holding its counter', async () => {
    renderSection('super_admin', createMockAdapters('super_admin', createDemoData()))

    const lines = await screen.findAllByTestId(/^device-operations-/)
    const texts = lines.map((line) => line.textContent ?? '')
    expect(texts).toContain('Nobody on shift')
    expect(texts.some((text) => / · since /.test(text))).toBe(true)
  })

  it('keeps billing totals out of the tablets', async () => {
    renderSection('super_admin', createMockAdapters('super_admin', createDemoData()))
    await screen.findAllByTestId('device-telemetry')

    const tablets = screen.getByTestId('outlet-tablets')
    for (const word of ['Bills rung', 'Open orders waiting', 'Cash', 'UPI']) {
      expect(within(tablets).queryByText(word)).not.toBeInTheDocument()
    }
  })

  it('keeps the newest outlet when an earlier read answers late', async () => {
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

    const { show } = renderSection('super_admin', adapters)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Reading the tablets' })).toBeDisabled()

    show(OUTLET_KANCHRAPARA_ID)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByTestId('device-telemetry')).toHaveLength(1))

    await act(async () => resolveFirst(firstScope))

    // The old Kalyani answer arrives after the page has moved on. It may not
    // publish Kalyani's tills under Kanchrapara's name or claim it has none.
    expect(screen.getAllByTestId('device-telemetry')).toHaveLength(1)
    expect(
      screen.queryByText(/No tablet is set up at Shawarmania Kanchrapara/i),
    ).not.toBeInTheDocument()
  })

  it('shows a setup code once, and says that it is once', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin', createDemoData())
    await removeEveryTabletAt(adapters, OUTLET_KALYANI_ID)

    renderSection('franchise_admin', adapters)
    await user.click(await screen.findByTestId('add-tablet'))
    await user.type(screen.getByLabelText('What to call it'), 'Kalyani counter tablet')
    await user.click(screen.getByRole('button', { name: /generate a code/i }))

    const shown = await screen.findByText(/is not shown again/i)
    expect(screen.getByText('DEMO0-SETUP')).toBeInTheDocument()
    expect(shown).toHaveTextContent(/choose set up this tablet from sign in/i)
  })

  /**
   * On 2026-08-11 the Tablets page told somebody to check their internet
   * connection because `counter-devices` had never been deployed. The adapter
   * classifies correctly now; this is the other half, that its sentence survives
   * the section's own catch and reaches the person.
   */
  it('reports a backend fault as a fault to report, not as a bad connection', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin', createDemoData())
    await removeEveryTabletAt(adapters, OUTLET_KALYANI_ID)
    adapters.counter.issueSetupCode = () => {
      throw new CounterActionError(
        'unsendable',
        'This app could not send that action. Nothing was recorded. Please report this.',
      )
    }

    renderSection('franchise_admin', adapters)
    await user.click(await screen.findByTestId('add-tablet'))
    await user.type(screen.getByLabelText('What to call it'), 'Kalyani counter tablet')
    await user.click(screen.getByRole('button', { name: /generate a code/i }))

    const alert = await screen.findByTestId('devices-error')
    expect(alert).toHaveTextContent(/could not send that action/i)
    expect(alert).toHaveTextContent(/report this/i)
    expect(alert).not.toHaveTextContent(/internet connection/i)
    expect(alert).not.toHaveTextContent(/reach shawarmania/i)
    expect(alert).not.toHaveTextContent(/try again/i)
    expect(screen.queryByText(/is not shown again/i)).not.toBeInTheDocument()
  })

  it('names what would be left unsent before it removes a tablet', async () => {
    const user = userEvent.setup()
    renderSection(
      'super_admin',
      createMockAdapters('super_admin', createDemoData()),
      OUTLET_KANCHRAPARA_ID,
    )

    // Kanchrapara's tablet carries three unsent: the number somebody will ask
    // about afterwards.
    await user.click(await screen.findByRole('button', { name: 'Remove Counter tablet' }))

    const consequence = await screen.findByText(/This is permanent/i)
    expect(consequence).toHaveTextContent(/3 unresolved/i)
    expect(consequence).toHaveTextContent(/nothing else can send it/i)
  })
})
