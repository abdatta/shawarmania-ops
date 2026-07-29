import { describe, expect, it } from 'vitest'

import { AlertActionError } from '../adapters'
import { createMockAlertsAdapter } from './alerts'
import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID, type DemoStore } from './store'
import { personaFixtures } from './fixtures/personas'

/**
 * What the alerts mock has to get right, because the real policies will:
 * the outlet boundary, the transition sequence, and the fact that reading is
 * not acting.
 */
describe('mock alerts adapter', () => {
  const asOwner = (): { store: DemoStore; adapter: ReturnType<typeof createMockAlertsAdapter> } => {
    const store = createDemoStore()
    return {
      store,
      adapter: createMockAlertsAdapter(store, 'super_admin', {
        userId: personaFixtures.super_admin.profile.id,
        outletId: null,
      }),
    }
  }

  const asManager = (outletId = DEMO_OUTLET_ID) => {
    const store = createDemoStore()
    return {
      store,
      adapter: createMockAlertsAdapter(store, 'franchise_admin', {
        userId: personaFixtures.franchise_admin.profile.id,
        outletId,
      }),
    }
  }

  it('gives the owner every outlet’s alerts, each naming its outlet', async () => {
    const { store, adapter } = asOwner()
    const alerts = await adapter.listAlerts()

    expect(alerts).toHaveLength(store.alerts.length)
    expect(new Set(alerts.map((alert) => alert.outletId)).size).toBeGreaterThan(1)
    expect(alerts.every((alert) => alert.outletName.length > 0)).toBe(true)
  })

  it('surfaces what has not been read before what has', async () => {
    const { adapter } = asOwner()
    const alerts = await adapter.listAlerts()

    const firstResolved = alerts.findIndex((alert) => alert.status === 'resolved')
    const lastOpen = alerts.map((alert) => alert.status).lastIndexOf('open')
    expect(lastOpen).toBeLessThan(firstResolved)
    expect(alerts[0]?.status).toBe('open')
  })

  it('gives a manager only their own outlet’s alerts', async () => {
    const { adapter } = asManager()
    const alerts = await adapter.listAlerts()

    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts.every((alert) => alert.outletId === DEMO_OUTLET_ID)).toBe(true)
  })

  it('returns nothing when a manager names another outlet, rather than throwing', async () => {
    const { adapter } = asManager()
    expect(await adapter.listAlerts({ outletId: DEMO_SECOND_OUTLET_ID })).toEqual([])
  })

  it('hides another outlet’s alert even when its id is known', async () => {
    const { store, adapter } = asManager()
    const other = store.alerts.find((alert) => alert.outlet_id === DEMO_SECOND_OUTLET_ID)

    expect(other).toBeDefined()
    expect(await adapter.getAlert(other?.id ?? '')).toBeNull()
  })

  it('records a raised alert as open, against the caller’s own outlet', async () => {
    const { adapter } = asManager()
    const raised = await adapter.raiseAlert({
      outletId: DEMO_OUTLET_ID,
      category: 'equipment',
      priority: 'urgent',
      subject: 'Freezer is not holding temperature',
      message: 'It read −4 this morning. Nothing has been thrown away yet.',
    })

    expect(raised.status).toBe('open')
    expect(raised.outletId).toBe(DEMO_OUTLET_ID)
    expect(raised.raisedByName).toBe(personaFixtures.franchise_admin.profile.full_name)
    expect((await adapter.listAlerts()).some((alert) => alert.id === raised.id)).toBe(true)
  })

  it('refuses to raise an alert for another outlet', async () => {
    const { adapter } = asManager()
    await expect(
      adapter.raiseAlert({
        outletId: DEMO_SECOND_OUTLET_ID,
        category: 'other',
        priority: 'low',
        subject: 'Subject',
        message: 'Message',
      }),
    ).rejects.toBeInstanceOf(AlertActionError)
  })

  it('refuses a blank subject or message, and records nothing', async () => {
    const { store, adapter } = asManager()
    const before = store.alerts.length

    await expect(
      adapter.raiseAlert({
        outletId: DEMO_OUTLET_ID,
        category: 'other',
        priority: 'low',
        subject: '   ',
        message: 'Message',
      }),
    ).rejects.toThrowError(/subject/i)
    await expect(
      adapter.raiseAlert({
        outletId: DEMO_OUTLET_ID,
        category: 'other',
        priority: 'low',
        subject: 'Subject',
        message: '\n\t ',
      }),
    ).rejects.toThrowError(/message/i)

    expect(store.alerts).toHaveLength(before)
  })

  it('adds a response without moving the status', async () => {
    const { store, adapter } = asOwner()
    const open = store.alerts.find((alert) => alert.status === 'open')
    const detail = await adapter.respond(open?.id ?? '', 'Looking into it this afternoon.')

    expect(detail.status).toBe('open')
    expect(detail.responses.at(-1)?.message).toBe('Looking into it this afternoon.')
    expect(detail.responses.at(-1)?.responderName).toBe(
      personaFixtures.super_admin.profile.full_name,
    )
  })

  it('walks the sequence and refuses to skip a step', async () => {
    const { store, adapter } = asOwner()
    const open = store.alerts.find((alert) => alert.status === 'open')
    const id = open?.id ?? ''

    await expect(adapter.setStatus(id, 'closed')).rejects.toThrowError(/cannot go straight/)
    expect((await adapter.getAlert(id))?.status).toBe('open')

    expect((await adapter.setStatus(id, 'acknowledged')).status).toBe('acknowledged')
    expect((await adapter.setStatus(id, 'resolved')).status).toBe('resolved')
    expect((await adapter.setStatus(id, 'closed')).status).toBe('closed')
  })

  it('treats a closed alert as finished with', async () => {
    const { store, adapter } = asOwner()
    const open = store.alerts.find((alert) => alert.status === 'open')
    const id = open?.id ?? ''

    await adapter.setStatus(id, 'acknowledged')
    await adapter.setStatus(id, 'resolved')
    await adapter.setStatus(id, 'closed')

    await expect(adapter.setStatus(id, 'open')).rejects.toThrowError(/closed/)
    expect((await adapter.getAlert(id))?.status).toBe('closed')
  })

  it('refuses a manager acting on another outlet’s alert', async () => {
    const { store, adapter } = asManager()
    const other = store.alerts.find((alert) => alert.outlet_id === DEMO_SECOND_OUTLET_ID)

    await expect(adapter.setStatus(other?.id ?? '', 'acknowledged')).rejects.toBeInstanceOf(
      AlertActionError,
    )
    await expect(adapter.respond(other?.id ?? '', 'Hello')).rejects.toBeInstanceOf(AlertActionError)
  })
})
