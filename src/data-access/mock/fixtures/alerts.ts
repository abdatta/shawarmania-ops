import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import { personaFixtures } from './personas'

/**
 * The alerts a walkthrough arrives to.
 *
 * **Each one points at something else in the scenario that the reader can go
 * and look at.** An alert about a problem that exists nowhere else in the data
 * is a sentence somebody typed; an alert about the pita bread that is genuinely
 * below its threshold, and the drawer that genuinely came up short, is the
 * product working. That correspondence is the whole reason this change owns the
 * demo gate.
 *
 * Offsets are business days back from today, so a walkthrough always shows a
 * plausible recent day. The store materialises the timestamps.
 */

const OWNER_ID = personaFixtures.super_admin.profile.id
const MANAGER_ID = personaFixtures.franchise_admin.profile.id
const KANCHRAPARA_MANAGER_ID = 'd1000000-0000-4000-a000-000000000005'

export interface AlertSeed {
  id: string
  outletId: string
  raisedBy: string
  category: Tables<'alerts'>['category']
  priority: Tables<'alerts'>['priority']
  status: Tables<'alerts'>['status']
  subject: string
  message: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** IST wall-clock time on that business day, `HH:MM`. */
  time: string
  responses?: {
    id: string
    responderId: string
    message: string
    daysAgo: number
    time: string
  }[]
}

export const alertSeeds: AlertSeed[] = [
  {
    // The open, high-priority one the proposal asks for — and it is about the
    // stock item that is actually low, so "go and look" is an instruction the
    // demo can survive.
    id: 'de000000-0000-4000-a000-000000000001',
    outletId: OUTLET_KALYANI_ID,
    raisedBy: MANAGER_ID,
    category: 'inventory',
    priority: 'high',
    status: 'open',
    subject: 'Pita bread will not last tomorrow',
    message:
      'Down to 8 packets after a split packet went in the bin last night. The usual supplier ' +
      'cannot deliver before Thursday. Can we approve buying from the Kanchrapara supplier this week?',
    daysAgo: 0,
    time: '10:40',
  },
  {
    // Acknowledged, with the owner's reply on it — so the thread is populated
    // before anybody types into it, and the response layout has been reviewed.
    id: 'de000000-0000-4000-a000-000000000002',
    outletId: OUTLET_KALYANI_ID,
    raisedBy: MANAGER_ID,
    category: 'cash_mismatch',
    priority: 'normal',
    status: 'acknowledged',
    subject: 'Drawer was short at close',
    message:
      'Counted twice and it was short by the same amount both times. Nothing unusual on the ' +
      'day — I have noted it on the cash record.',
    daysAgo: 1,
    time: '22:40',
    responses: [
      {
        id: 'df000000-0000-4000-a000-000000000001',
        responderId: OWNER_ID,
        message:
          'Seen. Leave it for now and let me know if it happens again this week — one short ' +
          'evening is not a pattern.',
        daysAgo: 1,
        time: '23:05',
      },
    ],
  },
  {
    id: 'de000000-0000-4000-a000-000000000003',
    outletId: OUTLET_KALYANI_ID,
    raisedBy: MANAGER_ID,
    category: 'equipment',
    priority: 'normal',
    status: 'resolved',
    subject: 'Grill regulator replaced',
    message:
      'The regulator was leaking. Replaced it this afternoon; the expense is on today’s list.',
    daysAgo: 0,
    time: '13:20',
    responses: [
      {
        id: 'df000000-0000-4000-a000-000000000002',
        responderId: OWNER_ID,
        message: 'Good. Keep the receipt.',
        daysAgo: 0,
        time: '13:45',
      },
    ],
  },
  {
    // Kanchrapara's, so the owner's inbox is genuinely cross-outlet and the
    // outlet name on each row has something to distinguish.
    id: 'de000000-0000-4000-a000-000000000004',
    outletId: OUTLET_KANCHRAPARA_ID,
    raisedBy: KANCHRAPARA_MANAGER_ID,
    category: 'supplier',
    priority: 'low',
    status: 'open',
    subject: 'Packaging supplier raised prices',
    message:
      'Boxes are up by ₹2 each from next month. Worth asking the Kalyani supplier for a quote?',
    daysAgo: 1,
    time: '16:20',
  },
]
