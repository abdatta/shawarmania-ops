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
  DEMO_RUNNER_ACCOUNT_ID,
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
    expect(within(card).getByText(/account deactivated/)).toBeInTheDocument()
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
      expect(within(card).getByTestId('approval-note')).toHaveTextContent(
        'Approved by Demo Manager',
      ),
    )
    expect(within(card).getByTestId('approver-place')).toHaveTextContent(
      'Approver was at the outlet',
    )
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
    expect(within(card).getByTestId('approver-place')).toHaveTextContent('from the outlet')
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
    expect(
      screen.getByText('Earlier days at this outlet hold arrivals waiting for approval'),
    ).toBeInTheDocument()
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
    expect(await screen.findByTestId(`manual-${staffId}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByTestId('day-label')).not.toHaveTextContent('Today'))
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled()
    expect(screen.queryByTestId(`manual-${staffId}`)).not.toBeInTheDocument()
  })

  it('records a manual check-in with the manager stamped as enterer', async () => {
    const user = userEvent.setup()
    renderDay()

    // Demo Staff has nothing recorded today, so an arrival can still be typed
    // in. 04:00 is the earliest moment of any business day — the one time
    // guaranteed not to be in the future while that day is current.
    const staffId = personaFixtures.employee.profile.id
    await user.click(await screen.findByTestId(`manual-${staffId}`))
    expect(
      screen.getByText(/The record will permanently show that you entered it/),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('When did they arrive?'), '04:00')
    await user.click(screen.getByRole('button', { name: 'Record it under my name' }))

    const card = await screen.findByTestId(`day-${staffId}`)
    await waitFor(() =>
      expect(within(card).getByTestId('entered-by')).toHaveTextContent('Entered by Demo Manager'),
    )
    expect(within(card).getByText('manual entry')).toBeInTheDocument()
    // Recording it settled it: the enterer's stamp IS the decision, so the day
    // is not left waiting for its own author to approve it.
    expect(within(card).getByTestId('approval-note')).toHaveTextContent('Approved by Demo Manager')
    expect(within(card).queryByTestId('approver-place')).not.toBeInTheDocument()
  })

  it('asks the outlet only for its own day', async () => {
    const adapters = createMockAdapters()
    const list = vi.spyOn(adapters.attendance, 'listOutletDay')
    renderDay(adapters)

    await screen.findByTestId('attendance-day')
    expect(list).toHaveBeenCalledWith(OUTLET_KALYANI_ID, expect.any(String))
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

  it('names its outlet on every read, rather than resolving it from the session', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const range = vi.spyOn(adapters.attendance, 'listPersonRange')
    renderDay(adapters)

    await user.click(await screen.findByTestId('axis-person'))

    await waitFor(() => expect(range).toHaveBeenCalled())
    expect(range.mock.calls[0]?.[1]).toBe(OUTLET_KALYANI_ID)
  })

  it('summarises the range and lists its days, derived absences included', async () => {
    const user = userEvent.setup()
    renderDay()

    await user.click(await screen.findByTestId('axis-person'))
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

    await user.click(await screen.findByTestId('axis-person'))
    await screen.findByTestId('range-picker')
    const before = range.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    await waitFor(() => expect(range.mock.calls.length).toBeGreaterThan(before))
    expect(range.mock.calls.at(-1)?.[1]).toBe(OUTLET_KALYANI_ID)
  })
})

/**
 * The owner's cross-outlet view of unsettled days.
 *
 * This count spans every business day, which is why it is not the same number as
 * the waiting count on the day below it: an outlet can hold nothing today and a
 * week of unsettled days behind it. The owner is the one person who cannot notice
 * a forgotten approval by opening their own outlet, so noticing and acting are
 * made one gesture.
 */
describe("the owner's stranded days", () => {
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

  it('gives each outlet a chip carrying its own count', async () => {
    renderAsOwner()

    const stranded = await screen.findByTestId('stranded-days')
    const chip = within(stranded).getByTestId(`stranded-${OUTLET_KANCHRAPARA_ID}`)
    expect(chip).toHaveTextContent('Shawarmania Kanchrapara')
    expect(chip).toHaveTextContent('5')
    expect(within(chip).getByText('5 arrivals waiting for approval')).toBeInTheDocument()
  })

  it('no longer describes a database state, nor prints an oldest date', async () => {
    renderAsOwner()

    // The heading described what the table held rather than asking for
    // anything, and the date it printed changed job: it now marks the
    // earlier-days control instead (design D3).
    const stranded = await screen.findByTestId('stranded-days')
    expect(stranded).not.toHaveTextContent('Days waiting for a manager')
    expect(stranded).not.toHaveTextContent('oldest')
  })

  it('follows a stranded count to the outlet it belongs to', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    // The outlet in scope is stated rather than offered: there is nowhere to go.
    const here = await screen.findByTestId(`stranded-${OUTLET_KALYANI_ID}`)
    expect(here).toHaveTextContent('this outlet')
    expect(here.tagName).not.toBe('BUTTON')

    await user.click(screen.getByTestId(`stranded-${OUTLET_KANCHRAPARA_ID}`))

    // One gesture from noticing to acting, rather than a count followed by
    // hunting through the picker.
    await waitFor(() =>
      expect(screen.getByTestId('surface-outlet')).toHaveValue(OUTLET_KANCHRAPARA_ID),
    )
    expect(await screen.findByTestId(`stranded-${OUTLET_KANCHRAPARA_ID}`)).toHaveTextContent(
      'this outlet',
    )
  })

  it('shows nothing at all when the outlet in scope is the only one waiting', async () => {
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

    // The header already names the outlet and the day controls already say
    // there is work behind this day. A chip about where the reader already is
    // repeats both and points nowhere.
    await screen.findByTestId('attendance-day')
    expect(screen.queryByTestId('stranded-days')).not.toBeInTheDocument()
  })

  it('shows a manager nothing about other outlets', async () => {
    renderDay()

    await screen.findByTestId('attendance-day')
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
    await user.click(screen.getByTestId('axis-person'))

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
