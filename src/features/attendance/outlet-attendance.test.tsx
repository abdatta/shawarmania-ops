import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters, WaitingCount } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { resolveBusinessDate } from '@/domain'
import {
  createMockAdapters,
  DEMO_GRILLER_ACCOUNT_ID,
  DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID,
  DEMO_PREP_COOK_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
  DEMO_TWO_OUTLETS_ACCOUNT_ID,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OutletAttendance } from './outlet-attendance'

/**
 * The manager's surface, along both axes.
 *
 * What matters here is that nothing hides: every current staff member appears
 * whether or not they have a record — deactivated people included — an arrival
 * nobody has approved is distinguishable at a glance and counted, and a manual
 * entry permanently names who typed it in.
 *
 * And the approval rule as the UI applies it: standing at the counter on the day
 * is one tap with no sheet at all, while approving from anywhere or any day else
 * asks for a reason first. The geolocation stub is what makes the difference
 * between those two testable, which is why `src/lib/geolocation.ts` is one
 * module.
 */

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346, accuracy: 12 }
/** Far outside a 150 m fence. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362, accuracy: 45 }

let getCurrentPosition: ReturnType<typeof vi.fn>

function atPosition(coords: { latitude: number; longitude: number; accuracy: number }) {
  getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
    onSuccess({ coords, timestamp: Date.now() } as GeolocationPosition),
  )
}

function positionFails(code: number) {
  getCurrentPosition.mockImplementation((_ok: PositionCallback, onError: PositionErrorCallback) =>
    onError({ code } as GeolocationPositionError),
  )
}

beforeEach(() => {
  getCurrentPosition = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation')
})

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

/**
 * The roll-call cards in the order they are rendered.
 *
 * Keyed on a person id so `day-label` and anything else beginning "day-" cannot
 * creep into an assertion about ordering.
 */
function dayCards(): HTMLElement[] {
  return screen.getAllByTestId(/^day-[0-9a-f-]{36}$/)
}

/**
 * Open one roll-call row.
 *
 * A row collapses to its headline unless it is waiting for a manager, so
 * anything about the evidence, the approval or the manual-entry action on a
 * settled row has to open it first. A row with nothing underneath has no
 * toggle at all, and asking to open one is then a no-op rather than a failure.
 */
async function openRow(user: ReturnType<typeof userEvent.setup>, personId: string) {
  const toggle = screen.queryByTestId(`expand-${personId}`)
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') await user.click(toggle)
}

/**
 * Stage what is waiting where, rather than seeding it.
 *
 * The day controls' marks are about business days other than the one on screen,
 * and the fixtures hold a fixed handful at one outlet. Staging the counts is
 * what makes "an older day exists" and "only another outlet's does" two
 * different, deterministic tests; the counting itself is covered against the
 * adapters.
 */
function stageCounts(adapters: DataAdapters, counts: WaitingCount[]) {
  vi.spyOn(adapters.attendance, 'countWaitingByOutlet').mockResolvedValue(counts)
}

/** The business day the view opens on, which every mark is measured against. */
async function todayAt(adapters: DataAdapters, outletId: string) {
  const outlet = await adapters.outlets.getOutlet(outletId)
  if (!outlet) throw new Error('missing outlet fixture')
  return resolveBusinessDate(new Date(), outlet.business_day_cutover)
}

function renderDay(adapters: DataAdapters = createMockAdapters()) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletAttendance />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the outlet attendance day', () => {
  it('lists every current staff member, including those with nothing recorded', async () => {
    renderDay()

    const day = await screen.findByTestId('attendance-day')
    expect(within(day).getByText(/Demo Griller/)).toBeInTheDocument()
    expect(within(day).getByText(/Demo Helper/)).toBeInTheDocument()
    // No check-in today, and still listed — the people who never arrived are
    // exactly what a day view must not hide.
    expect(within(day).getByText(/Demo Staff/)).toBeInTheDocument()
    // A day with no row still reads as something. Which of the two derived
    // readings shows depends on the clock the suite runs at; a blank does not.
    expect(
      within(day).queryAllByTestId('derived-absent').length +
        within(day).queryAllByTestId('not-yet-arrived').length,
    ).toBeGreaterThan(0)
  })

  it('leaves departed people off the day', async () => {
    renderDay()

    await screen.findByTestId('attendance-day')
    expect(screen.queryByText(/Demo Former Staff/)).not.toBeInTheDocument()
  })

  it('keeps a deactivated person on the day — access cut is not departure', async () => {
    renderDay()

    const day = await screen.findByTestId('attendance-day')
    const card = within(day).getByTestId(`day-d1000000-0000-4000-a000-000000000013`)
    expect(within(card).getByText(/Demo Prep Cook/)).toBeInTheDocument()
    expect(within(card).getByText(/deactivated/)).toBeInTheDocument()
  })

  it('distinguishes arrivals waiting for approval, and counts them', async () => {
    renderDay()

    // Two today: the runner's out-of-fence reading and the prep cook's in-fence
    // one. Inside the fence buys nothing now — only an approval settles a day.
    expect(await screen.findByTestId('day-waiting')).toHaveTextContent('2')
    expect(screen.getByText('2 arrivals waiting for approval on this day')).toBeInTheDocument()
    expect(screen.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`)).toBeInTheDocument()
    // The griller's day was approved in the fixtures, so it needs nothing.
    expect(screen.queryByTestId(`approve-${DEMO_GRILLER_ACCOUNT_ID}`)).not.toBeInTheDocument()
  })

  it('reads somebody with no arrival as a derived state, never as a blank row', async () => {
    renderDay()

    const day = await screen.findByTestId('attendance-day')
    // Demo Staff has nothing recorded today. Which of the two readings shows
    // depends on the clock the suite runs at, and both are correct answers to
    // "what does a day with no row say" — a bare row with no reading is not.
    expect(
      within(day).queryAllByTestId('derived-absent').length +
        within(day).queryAllByTestId('not-yet-arrived').length,
    ).toBeGreaterThan(0)
  })

  it('shows the evidence a decision has to be made on', async () => {
    renderDay()
    const card = await screen.findByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)

    // Distance and the reading's own accuracy, beside the verdict — the two
    // numbers a manager needs to judge a drifting fix.
    expect(within(card).getByText(/from the outlet/)).toBeInTheDocument()
    expect(within(card).getByText(/±65 m/)).toBeInTheDocument()
    expect(within(card).getByText('Waiting for a manager to approve')).toBeInTheDocument()
  })

  it('denies with exactly a reason and an unchecked retry lock, without reading manager location', async () => {
    const user = userEvent.setup()
    const { adapters } = renderDay()

    await user.click(await screen.findByTestId(`deny-${DEMO_RUNNER_ACCOUNT_ID}`))
    expect(screen.getByLabelText('Reason')).toHaveValue('Not at outlet')
    expect(screen.getByTestId('prevent-retry')).not.toBeChecked()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)

    await user.clear(screen.getByLabelText('Reason'))
    expect(screen.getByRole('button', { name: 'Deny check-in' })).toBeDisabled()
    await user.type(screen.getByLabelText('Reason'), 'Seen working at another shop')
    await user.click(screen.getByRole('button', { name: 'Deny check-in' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getCurrentPosition).not.toHaveBeenCalled()
    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    const record = await adapters.attendance.getDay(DEMO_RUNNER_ACCOUNT_ID, today)
    expect(record?.status).toBe('absent')
    expect(record?.retry.allowed).toBe(true)
    expect(record?.decisions.at(-1)).toMatchObject({
      kind: 'deny',
      reason: 'Seen working at another shop',
      preventsRetry: false,
      latitude: null,
    })
  })

  it('can opt into preventing retries and later reopen them through the compact correction', async () => {
    const user = userEvent.setup()
    const { adapters } = renderDay()

    await user.click(await screen.findByTestId(`deny-${DEMO_RUNNER_ACCOUNT_ID}`))
    await user.click(screen.getByTestId('prevent-retry'))
    await user.click(screen.getByRole('button', { name: 'Deny check-in' }))
    await openRow(user, DEMO_RUNNER_ACCOUNT_ID)
    await user.click(await screen.findByTestId(`correct-${DEMO_RUNNER_ACCOUNT_ID}`))

    expect(screen.getByLabelText('Correction')).toHaveValue('present')
    await user.selectOptions(screen.getByLabelText('Correction'), 'allow_retry')
    await user.type(screen.getByLabelText('Reason'), 'Employee should check in at Kanchrapara')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    await waitFor(async () => {
      const record = await adapters.attendance.getDay(DEMO_RUNNER_ACCOUNT_ID, today)
      expect(record?.retry.allowed).toBe(true)
      expect(record?.decisions.at(-1)?.kind).toBe('allow_retry')
    })
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('corrects present to absent with a reason and no manager location', async () => {
    const user = userEvent.setup()
    const { adapters } = renderDay()

    const grillerRow = await screen.findByTestId(`expand-${DEMO_GRILLER_ACCOUNT_ID}`)
    if (grillerRow.getAttribute('aria-expanded') === 'false') await user.click(grillerRow)
    await user.click(await screen.findByTestId(`correct-${DEMO_GRILLER_ACCOUNT_ID}`))
    expect(screen.getByLabelText('Correction')).toHaveValue('absent')
    await user.type(screen.getByLabelText('Reason'), 'Shift record was assigned to the wrong day')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    await waitFor(async () => {
      const record = await adapters.attendance.getDay(DEMO_GRILLER_ACCOUNT_ID, today)
      expect(record?.status).toBe('absent')
      expect(record?.decisions.at(-1)).toMatchObject({
        kind: 'correct_absent',
        reason: 'Shift record was assigned to the wrong day',
        latitude: null,
      })
    })
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('corrects denied absence to present with manager position and retained employee evidence', async () => {
    const user = userEvent.setup()
    const { adapters } = renderDay()
    atPosition(AT_COUNTER)

    await user.click(await screen.findByTestId(`deny-${DEMO_RUNNER_ACCOUNT_ID}`))
    await user.click(screen.getByRole('button', { name: 'Deny check-in' }))
    await openRow(user, DEMO_RUNNER_ACCOUNT_ID)
    await user.click(await screen.findByTestId(`correct-${DEMO_RUNNER_ACCOUNT_ID}`))
    await user.type(screen.getByLabelText('Reason'), 'Manager confirmed the employee was present')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    await waitFor(async () => {
      const record = await adapters.attendance.getDay(DEMO_RUNNER_ACCOUNT_ID, today)
      expect(record?.status).toBe('present')
      expect(record?.attempts.at(0)?.distanceMetres).toBeGreaterThan(150)
      expect(record?.decisions.at(-1)).toMatchObject({
        kind: 'correct_present',
        reason: 'Manager confirmed the employee was present',
      })
      expect(record?.decisions.at(-1)?.distanceMetres).toBeLessThan(150)
    })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('reveals a mandatory check-in time only for the time-correction option', async () => {
    const user = userEvent.setup()
    const { adapters } = renderDay()
    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    const existing = await adapters.attendance.getDay(DEMO_GRILLER_ACCOUNT_ID, today)
    expect(existing).not.toBeNull()
    const correct = vi.spyOn(adapters.attendance, 'correct').mockResolvedValue(existing!)

    const grillerRow = await screen.findByTestId(`expand-${DEMO_GRILLER_ACCOUNT_ID}`)
    if (grillerRow.getAttribute('aria-expanded') === 'false') await user.click(grillerRow)
    await user.click(await screen.findByTestId(`correct-${DEMO_GRILLER_ACCOUNT_ID}`))
    expect(screen.queryByLabelText('Corrected check-in time')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Correction'), 'time')
    const save = screen.getByRole('button', { name: 'Save correction' })
    expect(screen.getByLabelText('Corrected check-in time')).toBeRequired()
    await user.type(screen.getByLabelText('Reason'), 'Paper register has the correct time')
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Corrected check-in time'), '10:30')
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(correct).toHaveBeenCalledTimes(1))
    expect(correct).toHaveBeenCalledWith(
      expect.objectContaining({
        attendanceId: existing!.id,
        action: 'time',
        reason: 'Paper register has the correct time',
        reading: null,
        correctedAt: expect.any(String),
      }),
    )
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('approves in one tap from inside the fence on the day, asking nothing', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const approve = vi.spyOn(adapters.attendance, 'approve')
    atPosition(AT_COUNTER)
    renderDay(adapters)

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))

    // No sheet, no typing: the honest path is deliberately the cheapest one.
    await waitFor(() => expect(approve).toHaveBeenCalled())
    expect(screen.queryByTestId('reason-required')).not.toBeInTheDocument()
    expect(approve.mock.calls[0]?.[1].reason).toBeNull()

    const card = await screen.findByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
    await waitFor(() =>
      expect(within(card).getByTestId('approval-note')).toHaveTextContent(/Demo Manager, /),
    )
    expect(within(card).getByTestId('approver-place')).toHaveTextContent('Approver: on site')
  })

  it('asks for a reason when the manager is away from the outlet', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const approve = vi.spyOn(adapters.attendance, 'approve')
    atPosition(DOWN_THE_ROAD)
    renderDay(adapters)

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))

    expect(await screen.findByTestId('reason-required')).toHaveTextContent(
      'You are not at the outlet',
    )
    expect(approve).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText('Why are you approving this?'),
      'Seen at the counter at 9:30 before I left',
    )
    await user.click(screen.getByRole('button', { name: /Approve and record my reason/ }))

    await waitFor(() => expect(approve).toHaveBeenCalled())
    const card = await screen.findByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
    await waitFor(() =>
      expect(within(card).getByTestId('approval-note')).toHaveTextContent(
        'Seen at the counter at 9:30 before I left',
      ),
    )
    // Recorded, not refused — and the row says the approver was not there.
    expect(within(card).getByTestId('approver-place')).toHaveTextContent(/Approver: [\d.]+ m/)
  })

  it('asks for a reason when no position could be read at all', async () => {
    const user = userEvent.setup()
    positionFails(1)
    renderDay()

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))

    expect(await screen.findByTestId('reason-required')).toHaveTextContent(
      'Your position could not be read',
    )
  })

  it('will not send an approval whose required reason is blank or only spaces', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const approve = vi.spyOn(adapters.attendance, 'approve')
    atPosition(DOWN_THE_ROAD)
    renderDay(adapters)

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))
    await screen.findByTestId('reason-required')
    const submit = screen.getByRole('button', { name: /Approve and record my reason/ })

    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText('Why are you approving this?'), '   ')
    await user.click(submit)

    expect(approve).not.toHaveBeenCalled()
  })

  it('offers no way to settle more than one day at once', async () => {
    renderDay()

    // The count still tells a manager there is work waiting. What is deliberately
    // gone is the single button that would clear it without looking at it: an
    // approval is meant to be the moment somebody remembers this person turning
    // up for this shift (design D8).
    expect(await screen.findByTestId('day-waiting')).toBeInTheDocument()
    expect(screen.queryByTestId('approve-all')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve all/i })).not.toBeInTheDocument()
  })

  it('lists arrivals waiting for approval above the rest of the roll-call', async () => {
    renderDay()
    await screen.findByTestId('attendance-day')

    const waiting = dayCards().map(
      (card) => within(card).queryByRole('button', { name: 'Approve' }) !== null,
    )

    // More than one waiting row, and none of them after a row that is settled:
    // the work a manager came here to do is at the top (design D12).
    expect(waiting.filter(Boolean).length).toBeGreaterThan(1)
    expect(waiting).toEqual([...waiting].sort((a, b) => Number(b) - Number(a)))
  })

  it('leaves the roll-call order alone when a day is settled', async () => {
    const user = userEvent.setup()
    atPosition(AT_COUNTER)
    renderDay()
    await screen.findByTestId('attendance-day')

    const before = dayCards().map((card) => card.dataset.testid)
    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))
    await waitFor(() =>
      expect(
        within(screen.getByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)).getByTestId('approval-note'),
      ).toBeInTheDocument(),
    )

    // The settled row keeps its place. Re-sorting here would drop it down the
    // list and slide the next person's Approve button under a moving thumb.
    expect(dayCards().map((card) => card.dataset.testid)).toEqual(before)
  })

  it('reads the position once for approvals given in quick succession', async () => {
    const user = userEvent.setup()
    atPosition(AT_COUNTER)
    renderDay()
    await screen.findByTestId('attendance-day')

    const buttons = screen
      .getAllByTestId(/^approve-[0-9a-f-]{36}$/)
      .map((button) => button.dataset.testid as string)
    expect(buttons.length).toBeGreaterThan(1)

    for (const testid of buttons) {
      await user.click(screen.getByTestId(testid))
      await waitFor(() => expect(screen.queryByTestId(testid)).not.toBeInTheDocument())
    }

    // One reading for the run rather than one per person, so approving one at a
    // time does not mean a GPS read each (design D11).
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('marks the earlier-days control when this outlet has an older unsettled day', async () => {
    const adapters = createMockAdapters()
    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    stageCounts(adapters, [
      {
        outletId: OUTLET_KALYANI_ID,
        outletName: 'Shawarmania Kalyani',
        waiting: 4,
        oldest: '2020-01-01',
        newest: today,
      },
    ])
    renderDay(adapters)

    expect(await screen.findByTestId('earlier-days-waiting')).toBeInTheDocument()
    // The dot says which way to go and says it out loud, because a dot that only
    // works for people who can see the accent colour is not a signal.
    expect(screen.getByText('Earlier days hold arrivals waiting for approval')).toBeInTheDocument()
    // Nothing after today, and today is where the view opens.
    expect(screen.queryByTestId('later-days-waiting')).not.toBeInTheDocument()
  })

  it("does not mark the day controls for another outlet's backlog", async () => {
    const adapters = createMockAdapters()
    stageCounts(adapters, [
      {
        outletId: OUTLET_KANCHRAPARA_ID,
        outletName: 'Shawarmania Kanchrapara',
        waiting: 9,
        oldest: '2020-01-01',
        newest: '2020-06-01',
      },
    ])
    renderDay(adapters)

    await screen.findByTestId('attendance-day')
    // The marks read the entry for the outlet in scope and nothing else, so a
    // backlog somewhere the manager cannot open cannot point them anywhere
    // (design D3).
    expect(screen.queryByTestId('earlier-days-waiting')).not.toBeInTheDocument()
    expect(screen.queryByTestId('later-days-waiting')).not.toBeInTheDocument()
  })

  it('marks neither control when the day on screen is the only one waiting', async () => {
    const adapters = createMockAdapters()
    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    stageCounts(adapters, [
      {
        outletId: OUTLET_KALYANI_ID,
        outletName: 'Shawarmania Kalyani',
        waiting: 2,
        oldest: today,
        newest: today,
      },
    ])
    renderDay(adapters)

    // The day carries its own count; there is nowhere else to be sent.
    expect(await screen.findByTestId('day-waiting')).toBeInTheDocument()
    expect(screen.queryByTestId('earlier-days-waiting')).not.toBeInTheDocument()
    expect(screen.queryByTestId('later-days-waiting')).not.toBeInTheDocument()
  })

  it('re-reads the counts when the app comes back to the foreground', async () => {
    const adapters = createMockAdapters()
    const today = await todayAt(adapters, OUTLET_KALYANI_ID)
    stageCounts(adapters, [
      {
        outletId: OUTLET_KALYANI_ID,
        outletName: 'Shawarmania Kalyani',
        waiting: 1,
        oldest: '2020-01-01',
        newest: today,
      },
    ])
    renderDay(adapters)
    await screen.findByTestId('earlier-days-waiting')

    // Somebody else settled the backlog while this phone was in an apron.
    stageCounts(adapters, [])
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() =>
      expect(screen.queryByTestId('earlier-days-waiting')).not.toBeInTheDocument(),
    )
  })

  it('makes no further request while a badged screen simply sits open', async () => {
    const adapters = createMockAdapters()
    stageCounts(adapters, [])
    const read = adapters.attendance.countWaitingByOutlet as ReturnType<typeof vi.fn>
    renderDay(adapters)
    await screen.findByTestId('attendance-day')
    const settled = read.mock.calls.length

    vi.useFakeTimers()
    try {
      // Ten minutes of nothing happening. A timer here would be a cost paid
      // continuously for a number nobody is looking at (design D4).
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    } finally {
      vi.useRealTimers()
    }

    expect(read.mock.calls.length).toBe(settled)
  })

  it('moves between business days and cannot walk into the future', async () => {
    const user = userEvent.setup()
    renderDay()

    expect(await screen.findByTestId('day-label')).toHaveTextContent('Today')
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    // Today offers manual entry to somebody with no arrival recorded; a past day
    // must not — the database refuses back-filling prior days, so the surface
    // does not offer it. The griller already arrived today, so the person with
    // nothing recorded is the one to ask.
    const staffId = personaFixtures.employee.profile.id
    await screen.findByTestId('attendance-day')
    await openRow(user, staffId)
    expect(await screen.findByTestId(`manual-${staffId}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByTestId('day-label')).not.toHaveTextContent('Today'))
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled()
    await openRow(user, staffId)
    expect(screen.queryByTestId(`manual-${staffId}`)).not.toBeInTheDocument()
  })

  it('records a manual check-in with the manager stamped as enterer', async () => {
    const user = userEvent.setup()
    renderDay()

    // Demo Staff has nothing recorded today, so an arrival can still be typed
    // in. 04:00 is the earliest moment of any business day — the one time
    // guaranteed not to be in the future while that day is current.
    const staffId = personaFixtures.employee.profile.id
    await screen.findByTestId('attendance-day')
    await openRow(user, staffId)
    await user.click(await screen.findByTestId(`manual-${staffId}`))
    expect(
      screen.getByText(/The record will permanently show that you entered it/),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('When did they arrive?'), '04:00')
    await user.click(screen.getByRole('button', { name: 'Record it under my name' }))

    const card = await screen.findByTestId(`day-${staffId}`)
    await waitFor(() =>
      expect(within(card).getByTestId('entered-by')).toHaveTextContent('Entered by: Demo Manager'),
    )
    // Visibly not a self check-in: the enterer stamp stands where the GPS
    // evidence would be, and no phone or distance chip appears at all.
    expect(within(card).queryByText('phone')).not.toBeInTheDocument()
    // Recording it settled it: the enterer's stamp IS the decision, so the day
    // is not left waiting for its own author to approve it.
    expect(within(card).getByTestId('approval-note')).toHaveTextContent(/Demo Manager, /)
    expect(within(card).queryByTestId('approver-place')).not.toBeInTheDocument()
  })

  it('asks only for the outlets in scope, as a set', async () => {
    const adapters = createMockAdapters()
    const list = vi.spyOn(adapters.attendance, 'listOutletDay')
    renderDay(adapters)

    await screen.findByTestId('attendance-day')
    expect(list).toHaveBeenCalledWith([OUTLET_KALYANI_ID], expect.any(String))
  })
})

/**
 * A row is a headline until it is opened, and a row asking for something is
 * already open.
 *
 * A roll-call of eight people rendering all of its evidence puts the two rows a
 * manager came to decide somewhere down a scroll. What must not happen is the
 * opposite mistake: burying `Approve` behind a chevron, which would add a tap in
 * front of the only thing this screen exists for.
 */
describe('the roll-call collapses to its headlines', () => {
  it('opens a row waiting for a manager, and leaves a settled one closed', async () => {
    renderDay()
    await screen.findByTestId('attendance-day')

    // The runner is waiting: open, evidence showing, Approve reachable in one tap.
    expect(screen.getByTestId(`expand-${DEMO_RUNNER_ACCOUNT_ID}`)).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`)).toBeInTheDocument()

    // The griller's day was approved in the fixtures, so it is a headline until
    // somebody asks for the detail.
    const griller = screen.getByTestId(`expand-${DEMO_GRILLER_ACCOUNT_ID}`)
    expect(griller).toHaveAttribute('aria-expanded', 'false')
    expect(
      within(screen.getByTestId(`day-${DEMO_GRILLER_ACCOUNT_ID}`)).queryByTestId('approval-note'),
    ).not.toBeInTheDocument()
  })

  it('shows the evidence once a closed row is opened', async () => {
    const user = userEvent.setup()
    renderDay()
    await screen.findByTestId('attendance-day')

    await user.click(screen.getByTestId(`expand-${DEMO_GRILLER_ACCOUNT_ID}`))

    const card = screen.getByTestId(`day-${DEMO_GRILLER_ACCOUNT_ID}`)
    expect(within(card).getByTestId('approval-note')).toBeInTheDocument()
    expect(within(card).getByText('Arrived')).toBeInTheDocument()
  })

  it('keeps a row open after its day is settled', async () => {
    const user = userEvent.setup()
    atPosition(AT_COUNTER)
    renderDay()
    await screen.findByTestId('attendance-day')

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))

    // Open state is the reader's decision, not a function of the row. Folding
    // away under the thumb that pressed it would hide what just happened.
    const card = await screen.findByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
    await waitFor(() => expect(within(card).getByTestId('approval-note')).toBeInTheDocument())
    expect(screen.getByTestId(`expand-${DEMO_RUNNER_ACCOUNT_ID}`)).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('gives no toggle to a row with nothing underneath it', async () => {
    const user = userEvent.setup()
    renderDay()
    await screen.findByTestId('attendance-day')

    /*
      Two days back the two-outlet person worked at Kanchrapara, which this
      manager cannot see: one bit crossed the boundary (design D3), and there is
      nothing else to render beside it.

      It is the only row left with genuinely nothing underneath. A day nobody has
      arrived for yet is still open to a typed-in arrival, so it has an action;
      an absence now opens onto its cause. This test used to name all three
      readings and only ever found the absence — so it was proving the rule
      against the one row that had a reason to become an exception to it.
    */
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByTestId('day-label')).not.toHaveTextContent('Today'))

    const card = await screen.findByTestId(`day-${DEMO_TWO_OUTLETS_ACCOUNT_ID}`)
    await waitFor(() => expect(within(card).getByTestId('working-elsewhere')).toBeInTheDocument())
    // Nothing to open — and the verdict is still on the face of it rather than
    // the row reading as a blank.
    expect(within(card).queryByTestId(/^expand-/)).not.toBeInTheDocument()
    expect(card).toHaveTextContent('Working at another outlet')
  })

  it('says why an absent day is absent, whether a manager decided it or the deadline did', async () => {
    const user = userEvent.setup()
    renderDay()
    await screen.findByTestId('attendance-day')

    // Yesterday holds both shapes of absence on one screen: the runner's
    // check-in was denied, so a person decided it, and colleagues with no row
    // at all are absent because the deadline passed. "Absent" alone leaves the
    // person it is about unable to tell those apart, or to dispute either.
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByTestId('day-label')).not.toHaveTextContent('Today'))
    await waitFor(() => expect(screen.getByTestId('attendance-day')).toBeInTheDocument())

    const decided = await screen.findByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
    await openRow(user, DEMO_RUNNER_ACCOUNT_ID)
    const decidedWhy = within(decided).getByTestId('absence-reason')
    // This session's manager is the one who denied it in the fixtures, so they
    // are told they did — reading your own decision back should not name you in
    // the third person.
    expect(decidedWhy).toHaveTextContent(/You denied the check-in\./)
    // And in the manager's own words, where they gave any.
    expect(decidedWhy).toHaveTextContent(/Not at outlet/)

    const derived = dayCards().find((card) => within(card).queryByTestId('derived-absent') !== null)
    expect(derived).toBeDefined()
    // It now has one thing beneath it, so it now has a chevron.
    await user.click(within(derived!).getByTestId(/^expand-/))
    const derivedWhy = within(derived!).getByTestId('absence-reason')
    // Names the deadline it was judged against rather than describing it, and
    // names neither the day nor the person — the card's heading is both.
    expect(derivedWhy).toHaveTextContent(/No check-in by \d\d:\d\d [ap]m\./)
    /*
      And the failure worth guarding above all others: this is somebody else's
      row, so the manager reading it must not be told that THEY failed to check
      in. Getting this backwards would be a false statement about a person's pay,
      shown to the person deciding it.
    */
    expect(derivedWhy).not.toHaveTextContent(/You did not check in/)
  })
})

/**
 * The second axis: one person over a range.
 *
 * The point of it is the pattern — present, late, absent and waiting counted
 * together — and the point of the read is that it names its outlet. A read shaped
 * by person is the shape that leaks when the outlet is left implicit (design D7),
 * so the surface passing it explicitly is worth asserting rather than assuming.
 */
describe('the outlet attendance person view', () => {
  // Same calendar trap as the employee's own month: the range defaults to this
  // month and the fixtures are days back from today, so the first of a month
  // leaves nothing in range. Only `Date` is faked; timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-20T12:00:00+05:30'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names no outlet at all, so the policy decides what comes back', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const range = vi.spyOn(adapters.attendance, 'listPersonRange')
    renderDay(adapters)

    await user.click(await screen.findByTestId('axis-staff'))

    // Person and dates, and nothing else (attendance-one-day-per-person,
    // design D4). "Every outlet this reader may see" is the intended meaning,
    // and it is resolved in the database from their own live assignments — so
    // naming a set here could only duplicate the policy or contradict it.
    await waitFor(() => expect(range).toHaveBeenCalled())
    expect(range.mock.calls[0]).toHaveLength(3)
    expect(range.mock.calls[0]?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.mock.calls[0]?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('summarises the range and lists its days, derived absences included', async () => {
    const user = userEvent.setup()
    renderDay()

    await user.click(await screen.findByTestId('axis-staff'))
    await user.selectOptions(
      await screen.findByTestId('person-picker'),
      personaFixtures.employee.profile.id,
    )

    const tally = await screen.findByTestId('attendance-tally')
    // The Employee persona's month holds approved days, a late one, a waiting
    // one and days with nothing recorded at all.
    await waitFor(() =>
      expect(Number(within(tally).getByTestId('tally-present').textContent)).toBeGreaterThan(0),
    )
    expect(Number(within(tally).getByTestId('tally-absent').textContent)).toBeGreaterThan(0)
    expect(await screen.findByTestId('attendance-range')).toBeInTheDocument()
  })

  it('walks to the previous month without leaving the outlet behind', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const range = vi.spyOn(adapters.attendance, 'listPersonRange')
    renderDay(adapters)

    await user.click(await screen.findByTestId('axis-staff'))
    await screen.findByTestId('range-picker')
    const before = range.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    await waitFor(() => expect(range.mock.calls.length).toBeGreaterThan(before))
    // A different month, and still no outlet named.
    expect(range.mock.calls.at(-1)).toHaveLength(3)
    expect(range.mock.calls.at(-1)?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/**
 * Where days are stranded, on the chips that reach them.
 *
 * This count spans every business day, which is why it is not the same number as
 * the waiting count on the day below it: an outlet can hold nothing today and a
 * week of unsettled days behind it. It used to be a second row of chips above the
 * selector naming the same outlets in the same shape; the count belongs on the
 * control that acts, so noticing a backlog and reaching it are one gesture.
 */
describe('the outlet chips carry their unsettled days', () => {
  const ownerSession: Session = {
    mode: 'demo',
    userId: personaFixtures.super_admin.profile.id,
    assignments: personaFixtures.super_admin.assignments,
    ...deriveSessionScope(personaFixtures.super_admin.assignments),
    displayName: personaFixtures.super_admin.profile.full_name,
    persona: personaFixtures.super_admin,
  }

  /**
   * Days stranded at both outlets, staged rather than seeded.
   *
   * The fixtures happen to hold unsettled days at one outlet only, and what is
   * under test here is the rendering and the switch, not the counting — which
   * `countWaitingByOutlet` is covered for on its own.
   */
  function renderAsOwner(adapters: DataAdapters = createMockAdapters()) {
    stageCounts(adapters, [
      {
        outletId: OUTLET_KALYANI_ID,
        outletName: 'Shawarmania Kalyani',
        waiting: 2,
        oldest: '2026-07-20',
        newest: '2026-07-21',
      },
      {
        outletId: OUTLET_KANCHRAPARA_ID,
        outletName: 'Shawarmania Kanchrapara',
        waiting: 5,
        oldest: '2026-07-18',
        newest: '2026-07-25',
      },
    ])
    return render(
      <MemoryRouter>
        <SessionContext.Provider value={ownerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletAttendance />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )
  }

  it('gives each outlet one chip carrying its own count', async () => {
    renderAsOwner()

    // One row of outlets, not two. The chips that select are the chips that
    // count, so the row does not change shape depending on the database.
    const selector = await screen.findByTestId('surface-outlets')
    expect(screen.queryByTestId('stranded-days')).not.toBeInTheDocument()

    const chip = within(selector).getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)
    expect(chip).toHaveTextContent('Shawarmania Kanchrapara')
    expect(chip).toHaveTextContent('5')
    expect(within(chip).getByText('5 arrivals waiting for approval')).toBeInTheDocument()

    // Including the one already selected: a badge here says "there is work",
    // and the work does not stop existing because you are looking at it.
    const here = within(selector).getByTestId(`surface-outlet-${OUTLET_KALYANI_ID}`)
    expect(within(here).getByTestId(`outlet-waiting-${OUTLET_KALYANI_ID}`)).toHaveTextContent('2')
  })

  it('reaches a stranded outlet by selecting it, without dropping the one in hand', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    await screen.findByTestId('attendance-day')
    await user.click(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`))

    // One gesture from noticing to acting. Adding rather than replacing: the
    // reader is looking at one shop's day and wants the other one's work as
    // well, and clearing the first is the same control pressed again.
    await waitFor(() =>
      expect(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(screen.getByTestId(`surface-outlet-${OUTLET_KALYANI_ID}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('says nothing about an outlet holding nothing', async () => {
    const adapters = createMockAdapters()
    stageCounts(adapters, [
      {
        outletId: OUTLET_KALYANI_ID,
        outletName: 'Shawarmania Kalyani',
        waiting: 3,
        oldest: '2026-07-20',
        newest: '2026-07-28',
      },
    ])
    render(
      <MemoryRouter>
        <SessionContext.Provider value={ownerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletAttendance />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    await screen.findByTestId('attendance-day')
    // Absent rather than a nought, so an absent badge always means the same
    // thing (notification-badges, design D5).
    expect(screen.getByTestId(`outlet-waiting-${OUTLET_KALYANI_ID}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`outlet-waiting-${OUTLET_KANCHRAPARA_ID}`)).not.toBeInTheDocument()
  })

  it('shows a single-outlet manager no chips at all', async () => {
    renderDay()

    // Nothing to choose between, so no selector — and with one outlet the day's
    // own badge and the earlier/later marks already say everything a per-outlet
    // count could.
    await screen.findByTestId('attendance-day')
    expect(screen.queryByTestId('surface-outlets')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stranded-days')).not.toBeInTheDocument()
  })
})

/**
 * Who the roll-call is about (owner-reaches-every-outlet, design D3 and D4).
 *
 * Attendance is recorded for the people whose arrival the outlet tracks, so a
 * manager or an owner is on it only when they are also staff there. The one
 * exception is somebody who already carries a row on the day: the waiting counts
 * are computed from rows, and a row inside the count and outside the screen would
 * be a badge nobody could clear.
 */
describe('the roll-call is the outlet’s staff', () => {
  const DEMO_MANAGER_ID = personaFixtures.franchise_admin.profile.id

  it('leaves a manager who holds no staff assignment off the day', async () => {
    renderDay()

    // Demo Manager runs Kalyani and Demo Owner day-runs it too. Neither one's
    // arrival is recorded by anybody, so neither has a row of their own.
    //
    // Asserted on the cards rather than on the text: a manager's name legitimately
    // appears on somebody else's row, as the person who typed their arrival in.
    await screen.findByTestId('attendance-day')
    expect(screen.queryByTestId(`day-${DEMO_MANAGER_ID}`)).not.toBeInTheDocument()
    expect(
      screen.queryByTestId(`day-${personaFixtures.super_admin.profile.id}`),
    ).not.toBeInTheDocument()
  })

  it('lists a manager who is also staff at the outlet', async () => {
    const adapters = createMockAdapters()
    const real = await adapters.accounts.listAccounts()
    vi.spyOn(adapters.accounts, 'listAccounts').mockResolvedValue(
      real.map((account) =>
        account.id === DEMO_MANAGER_ID
          ? {
              ...account,
              assignments: [
                ...account.assignments,
                {
                  id: 'da000000-0000-4000-a000-0000000000fe',
                  role: 'employee' as const,
                  outletId: OUTLET_KALYANI_ID,
                  startedOn: '2026-07-01',
                  endedOn: null,
                },
              ],
            }
          : account,
      ),
    )
    renderDay(adapters)

    // Their attendance is a real thing now, and it is the staff assignment that
    // makes it one — not the fact that they manage the place.
    const card = await screen.findByTestId(`day-${DEMO_MANAGER_ID}`)
    expect(within(card).getByRole('heading')).toHaveTextContent('Demo Manager')
    // Listed as staff, so nothing calls them a stranger to the list.
    expect(within(card).queryByText(/not on this outlet’s staff list/)).not.toBeInTheDocument()
  })

  it('lists somebody off the staff list who carries a row, and lets the day be settled', async () => {
    const adapters = createMockAdapters()
    const businessDate = await todayAt(adapters, OUTLET_KALYANI_ID)
    // A manager's own arrival, recorded before the roll-call narrowed. Written
    // through the adapter, so it is counted exactly as any other row is.
    await adapters.attendance.checkIn({
      personId: DEMO_MANAGER_ID,
      outletId: OUTLET_KALYANI_ID,
      businessDate,
      reading: { ...AT_COUNTER, accuracyMetres: AT_COUNTER.accuracy, at: new Date().toISOString() },
    })
    const user = userEvent.setup()
    atPosition(AT_COUNTER)
    renderDay(adapters)

    const card = await screen.findByTestId(`day-${DEMO_MANAGER_ID}`)
    expect(within(card).getByText(/Demo Manager/)).toBeInTheDocument()
    // Said, rather than left as a mystery row on a list of staff.
    expect(within(card).getByText(/not on this outlet’s staff list/)).toBeInTheDocument()
    // And no way to type in an arrival for somebody who already has one.
    expect(screen.queryByTestId(`manual-${DEMO_MANAGER_ID}`)).not.toBeInTheDocument()

    // Three waiting now: the fixtures' two, and this one.
    expect(await screen.findByTestId('day-waiting')).toHaveTextContent('3')
    await user.click(within(card).getByTestId(`approve-${DEMO_MANAGER_ID}`))

    // The count that named them can be cleared, which is the whole reason the
    // row is still here.
    await waitFor(() => expect(screen.getByTestId('day-waiting')).toHaveTextContent('2'))
  })

  it('offers only staff in the by-person picker', async () => {
    const user = userEvent.setup()
    renderDay()

    await screen.findByTestId('attendance-day')
    await user.click(screen.getByTestId('axis-staff'))

    const picker = await screen.findByTestId('person-picker')
    const names = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(names).toContain('Demo Griller')
    // A range of days for somebody whose days are not tracked is a pattern of
    // nothing (design D5).
    expect(names).not.toContain('Demo Manager')
    expect(names).not.toContain('Demo Owner')
  })
})

/**
 * One day per person, read across a selection of outlets
 * (attendance-one-day-per-person).
 *
 * The bug this replaced: somebody staffed at two shops who worked at one of them
 * was derived ABSENT at the other, on the manager's day, on the by-staff view
 * and in their own history. That is a false statement about a day somebody is
 * paid for, so it is asserted from both sides here — the outlet they went to and
 * the one they did not.
 */
describe('a person who works at two outlets', () => {
  const ownerSession: Session = {
    mode: 'demo',
    userId: personaFixtures.super_admin.profile.id,
    assignments: personaFixtures.super_admin.assignments,
    ...deriveSessionScope(personaFixtures.super_admin.assignments),
    displayName: personaFixtures.super_admin.profile.full_name,
    persona: personaFixtures.super_admin,
  }

  function renderAsOwner(adapters: DataAdapters = createMockAdapters()) {
    return render(
      <MemoryRouter>
        <SessionContext.Provider value={ownerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletAttendance />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )
  }

  /** Step the day picker back from the day the view opened on. */
  async function goBack(user: ReturnType<typeof userEvent.setup>, days: number) {
    for (let step = 0; step < days; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Previous day' }))
    }
  }

  it('reads as working at another outlet, not absent, at the one they missed', async () => {
    const user = userEvent.setup()
    renderDay()
    await screen.findByTestId('attendance-day')

    // Two days back they worked at Kanchrapara. Kalyani's manager cannot see
    // that row at all, so without the database answering the one-bit question
    // they would read as absent (design D3).
    await goBack(user, 2)

    const card = await screen.findByTestId(`day-${DEMO_TWO_OUTLETS_ACCOUNT_ID}`)
    await waitFor(() => expect(within(card).getByTestId('working-elsewhere')).toBeInTheDocument())
    expect(within(card).queryByTestId('derived-absent')).not.toBeInTheDocument()
    // And nothing about where, when, or whether anybody approved it.
    expect(card).not.toHaveTextContent('Kanchrapara')
    expect(within(card).queryByTestId('approval-note')).not.toBeInTheDocument()
    // Nor an offer to type in an arrival for a day that is already taken.
    expect(screen.queryByTestId(`manual-${DEMO_TWO_OUTLETS_ACCOUNT_ID}`)).not.toBeInTheDocument()
  })

  it('reads as absent when they were at neither outlet', async () => {
    const user = userEvent.setup()
    renderDay()
    await screen.findByTestId('attendance-day')

    // Four days back holds nothing for them anywhere. A genuine absence has to
    // survive this change, or the fix would simply have hidden every absence.
    await goBack(user, 4)

    const card = await screen.findByTestId(`day-${DEMO_TWO_OUTLETS_ACCOUNT_ID}`)
    await waitFor(() => expect(within(card).getByTestId('derived-absent')).toBeInTheDocument())
  })

  it('shows the real row instead once both outlets are selected', async () => {
    const user = userEvent.setup()
    renderAsOwner()
    await screen.findByTestId('attendance-day')

    await user.click(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`))
    await goBack(user, 2)

    // Their actual day, at the outlet they attended, listed once — and no
    // working-elsewhere line, because the selection covers where they went.
    const card = await screen.findByTestId(`day-${DEMO_TWO_OUTLETS_ACCOUNT_ID}`)
    await waitFor(() =>
      expect(within(card).getByTestId('outlet-chip')).toHaveTextContent('Shawarmania Kanchrapara'),
    )
    expect(within(card).queryByTestId('working-elsewhere')).not.toBeInTheDocument()
    expect(screen.getAllByTestId(`day-${DEMO_TWO_OUTLETS_ACCOUNT_ID}`)).toHaveLength(1)
  })

  it('asks the day for the whole selection, as one read', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const list = vi.spyOn(adapters.attendance, 'listOutletDay')
    renderAsOwner(adapters)
    await screen.findByTestId('attendance-day')

    await user.click(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`))

    await waitFor(() =>
      expect(list.mock.calls.at(-1)?.[0]).toEqual(
        expect.arrayContaining([OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID]),
      ),
    )
  })

  it('does not reuse one position reading across two outlets', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    atPosition(AT_COUNTER)
    renderAsOwner(adapters)
    await screen.findByTestId('attendance-day')

    await user.click(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`))
    await screen.findByTestId('attendance-day')

    // Kalyani's waiting rows first: standing at that counter, each is one tap
    // and they share a single reading (design D11).
    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByTestId(`approve-${DEMO_PREP_COOK_ACCOUNT_ID}`))
    await waitFor(() =>
      expect(screen.queryByTestId(`approve-${DEMO_PREP_COOK_ACCOUNT_ID}`)).not.toBeInTheDocument(),
    )
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)

    // The Kanchrapara row, in the same minute. One reading cannot vouch for
    // standing in two places, so the window is keyed per outlet and this one
    // costs a read of its own (design D6).
    await user.click(await screen.findByTestId(`approve-${DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID}`))
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(2))

    // And it is judged against its own outlet's fence: the manager is standing
    // at Kalyani, so approving Kanchrapara's row asks for a reason.
    expect(await screen.findByTestId('reason-required')).toHaveTextContent(
      'You are not at the outlet',
    )
  })

  it('refuses to clear the last selected outlet', async () => {
    renderAsOwner()
    await screen.findByTestId('attendance-day')

    // An empty selection is a blank surface asking a question nobody asked for,
    // so the control says so before the press rather than swallowing it after.
    const only = screen.getByTestId(`surface-outlet-${OUTLET_KALYANI_ID}`)
    expect(only).toHaveAttribute('aria-pressed', 'true')
    expect(only).toBeDisabled()
  })

  it('offers every readable outlet’s staff, whatever the outlet chips say', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    // Kalyani alone is selected, and Kanchrapara's staff are still offered. The
    // by-staff axis takes its scope from the database, so filtering its picker
    // by the by-outlet chips would hide a whole shop's people from a view that
    // is not about shops — the exact confusion splitting the axes ended.
    await screen.findByTestId('attendance-day')
    expect(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await user.click(screen.getByTestId('axis-staff'))
    const picker = await screen.findByTestId('person-picker')
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value),
    ).toContain(DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID)
  })

  it('offers no outlet picker on the by-staff axis', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    // By outlet has one, because it is a filter within what they may already
    // see. By staff must not: its scope is the database's answer to who they
    // are, not a choice (design D4).
    await screen.findByTestId('attendance-day')
    expect(screen.getByTestId('surface-outlets')).toBeInTheDocument()
    await user.click(screen.getByTestId('axis-staff'))
    expect(screen.queryByTestId('surface-outlets')).not.toBeInTheDocument()
  })

  it('counts each business date once across both outlets', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    await user.click(await screen.findByTestId('axis-staff'))
    await user.selectOptions(
      await screen.findByTestId('person-picker'),
      DEMO_TWO_OUTLETS_ACCOUNT_ID,
    )

    const range = await screen.findByTestId('attendance-range')
    const dates = within(range)
      .getAllByTestId(/^range-day-/)
      .map((card) => card.dataset.testid)
    // One card per date. Assembled per outlet this list would hold each date
    // twice, half of them absences on days the person was at work.
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('shows a placeholder rather than the previous selection’s rows', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()

    // The second read is held open, so the in-flight moment is observable
    // rather than a race the test hopes to catch.
    let release: (rows: never[]) => void = () => undefined
    const real = adapters.attendance.listOutletDay.bind(adapters.attendance)
    let first = true
    vi.spyOn(adapters.attendance, 'listOutletDay').mockImplementation(async (ids, date) => {
      if (first) {
        first = false
        return real(ids, date)
      }
      return new Promise((resolve) => {
        release = resolve as (rows: never[]) => void
      })
    })

    renderAsOwner(adapters)
    await screen.findByTestId('attendance-day')

    await user.click(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`))

    // The previous selection's rows are gone before anything renders under the
    // new one's name, and the space they will occupy is reserved (design D8).
    const loading = await screen.findByTestId('day-loading')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('attendance-day')).not.toBeInTheDocument()

    release([])
    await waitFor(() => expect(screen.queryByTestId('day-loading')).not.toBeInTheDocument())
  })
})
