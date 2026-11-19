import { customerMatchStrength, parseCustomerQuery } from '@/domain'

import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

/**
 * The demo's crowd: two hundred invented customers who bought at the outlets
 * a while ago (a-campaign-goes-out-on-whatsapp).
 *
 * **Why they exist.** The seven named customers each make one moment of the
 * Customers walkthrough demonstrable, and seven is too few to choose a
 * campaign's customers from: a list of seven never scrolls, a filter barely
 * changes it, and Select all means nothing [owner, 2026-11-18]. The real
 * business has about a thousand numbers, most of them not seen lately.
 *
 * **Why they change nothing else.** Every visit is more than thirty days old,
 * so none of them is on the Customers page's Regulars list; none is gold; and
 * no name or number matches the searches the demo walkthrough names (`ghosh`,
 * `0104`, `mmta`), which `crowdFixtures` checks as it builds. Only the demo
 * root asks for them (`createDemoData({ customerCrowd: true })`), so every test
 * that does not ask reads the seven alone.
 *
 * **The first hundred were sent Weekend combo**, so the campaign filter on
 * having been sent one has somebody to leave out. They take the ids that
 * campaign's recipient rows already point at, `pastCustomerId(4)` onward.
 */

/** An id a seeded campaign's recipient row points at. */
export const pastCustomerId = (n: number) =>
  `dc000000-0000-4000-a000-${String(n).padStart(12, '0')}`

const crowdOnlyId = (n: number) => `dd000000-0000-4000-a000-${String(n).padStart(12, '0')}`

export const CROWD_SIZE = 200

/** How many of the crowd were recipients of the done campaign, Weekend combo. */
export const CROWD_SENT_WEEKEND_COMBO = 100

const FIRST_NAMES = [
  'Ananya',
  'Rahul',
  'Priya',
  'Sayan',
  'Debjani',
  'Arnab',
  'Tania',
  'Souvik',
  'Nabanita',
  'Abhijit',
  'Riya',
  'Subrata',
  'Paromita',
  'Kunal',
  'Sneha',
  'Tapas',
  'Ishita',
  'Rohan',
  'Barsha',
  'Sudip',
  'Payel',
  'Anirban',
  'Swati',
  'Dipankar',
  'Rupa',
  'Shubham',
  'Koyel',
  'Pritam',
  'Sohini',
  'Biswajit',
  'Ankita',
  'Rajdeep',
  'Puja',
  'Saikat',
  'Madhurima',
  'Tanmay',
  'Ritu',
  'Sanjib',
  'Oindrila',
  'Bikash',
] as const

const SURNAMES = [
  'Banerjee',
  'Chatterjee',
  'Mukherjee',
  'Bose',
  'Dutta',
  'Sarkar',
  'Roychowdhury',
  'Saha',
  'Paul',
  'Biswas',
  'Mondal',
  'Halder',
  'Kundu',
  'Sinha',
  'Bhattacharya',
  'Chakraborty',
  'Naskar',
  'Pramanik',
  'Mallick',
  'Nandi',
  'Majhi',
  'Karmakar',
  'Bag',
] as const

/** Searches the demo walkthrough names, whose answers the crowd must not change. */
const WALKTHROUGH_SEARCHES = ['ghosh', '0104', 'mmta'].map(parseCustomerQuery)

export interface CrowdCustomer {
  id: string
  phone: string
  name: string | null
  createdAt: string
  /** Each visit: where, how many business days ago (always more than 30), and what it came to. */
  visits: { outletId: string; daysAgo: number; time: string; totalPaise: number }[]
}

/** A small deterministic stream, so the crowd is the same in every walkthrough. */
function stream(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

export function crowdFixtures(): CrowdCustomer[] {
  const next = stream(84)
  const crowd: CrowdCustomer[] = []
  let serial = 0
  while (crowd.length < CROWD_SIZE) {
    serial += 1
    const index = crowd.length
    const first = FIRST_NAMES[Math.floor(next() * FIRST_NAMES.length)]!
    const last = SURNAMES[Math.floor(next() * SURNAMES.length)]!
    // About one in eight never gave a name, as at a real counter.
    const name = next() < 0.12 ? null : `${first} ${last}`
    // Seven thousand upward is outside the range the named demo customers use.
    const phone = `+9170000${String(10000 + serial * 37).slice(-5)}`
    const clashes = WALKTHROUGH_SEARCHES.some(
      (query) => customerMatchStrength(query, { name, phone }) !== null,
    )
    if (clashes) continue

    // Most bought a few times; a few were regulars once.
    const count = 1 + Math.floor(next() ** 2 * 9)
    const elsewhere = next() < 0.15
    const visits = Array.from({ length: count }, () => ({
      outletId: elsewhere && next() < 0.7 ? OUTLET_KANCHRAPARA_ID : OUTLET_KALYANI_ID,
      daysAgo: 35 + Math.floor(next() * 300),
      time: `${String(12 + Math.floor(next() * 10)).padStart(2, '0')}:${next() < 0.5 ? '15' : '45'}`,
      totalPaise: (150 + Math.floor(next() * 75) * 10) * 100,
    }))
    const oldest = Math.max(...visits.map((visit) => visit.daysAgo))
    crowd.push({
      id: index < CROWD_SENT_WEEKEND_COMBO ? pastCustomerId(4 + index) : crowdOnlyId(index + 1),
      phone,
      name,
      createdAt: new Date(Date.UTC(2026, 10, 18) - oldest * 86_400_000).toISOString(),
      visits,
    })
  }
  return crowd
}
