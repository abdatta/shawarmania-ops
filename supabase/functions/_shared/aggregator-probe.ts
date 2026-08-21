import { serviceClient } from './authority.ts'

/**
 * Is a channel's stored session actually alive?
 *
 * One authenticated call against the live API — never a stored expiry claim.
 * The claim cannot answer for Hyperpure, whose token carries no sliding-expiry
 * claim at all, and Zomato's own `bExp` has been observed stale while the
 * session still worked. One real call is the only honest probe. It costs one
 * HTTPS round trip, which is why it lives here rather than behind a runner
 * boot: the owner's tap should get its verdict in the first second.
 *
 * Header recipes are deliberately mirrored from the sync repository
 * (`shawarmania-sync/src/session.mjs` and `src/sources/zomato/api.mjs`), which
 * remain the source of truth captured against the live accounts. If a recipe
 * changes there, it changes here. Session material is never logged: this
 * module reads cookie values to forward them and nothing else.
 */

export interface ProbeResult {
  /** true = answered an authenticated call; false = refused; null = could not tell. */
  alive: boolean | null
  reason?: string
  status?: number
}

interface StoredCookie {
  name: string
  value: string
  domain?: string
}

function readState(session: string): { cookies: StoredCookie[] } | null {
  try {
    const parsed = JSON.parse(session)
    if (!Array.isArray(parsed?.cookies)) return null
    return parsed
  } catch {
    return null
  }
}

function cookiesFor(state: { cookies: StoredCookie[] }, domainIncludes: string): StoredCookie[] {
  return state.cookies.filter((cookie) => String(cookie.domain ?? '').includes(domainIncludes))
}

function cookieHeader(cookies: StoredCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

/** The Zomato auth token, whose JWT payload carries the account's outlets. */
function zomatoToken(state: { cookies: StoredCookie[] }): string | null {
  return (
    cookiesFor(state, 'zomato.com').find((c) => c.name === 'X-Zomato-Mx-Auth-Token')?.value ?? null
  )
}

/**
 * One restaurant id from the token itself, so probing needs no outlet map:
 * the JWT's `rrm` claim keys the restaurants the account may see.
 */
function firstRestaurantId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const ids = Object.keys(payload?.rrm ?? {})
    return ids.length > 0 ? ids[0] : null
  } catch {
    return null
  }
}

async function probeZomato(state: { cookies: StoredCookie[] }): Promise<ProbeResult> {
  const token = zomatoToken(state)
  if (!token) return { alive: false, reason: 'no_token' }
  const resId = firstRestaurantId(token)
  if (!resId) return { alive: false, reason: 'no_restaurant_in_token' }

  // The double-encoded blob the finance endpoints want, asking for the live
  // cycle of one of the account's own restaurants — the cheapest authenticated
  // call there is. Shape mirrored from sources/zomato/api.mjs currentCycle().
  const postbackParams = JSON.stringify({
    start_date: '0001-01-01',
    end_date: '0001-01-01',
    config_postback_params: [{ entityType: 'outlets', entityIds: [resId] }],
    entity_ids: [Number(resId)],
    cycleDateRange: JSON.stringify({
      start_date: '0001-01-01',
      end_date: '0001-01-01',
      entity_ids: [Number(resId)],
    }),
  })

  let res: Response
  try {
    res = await fetch('https://api.zomato.com/merchant-gw/web/finance/payouts/get-payout-cycles', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-client-id': 'zomato_web_merchant',
        'x-zomato-source-identifier': 'merchant_finance',
        'x-zomato-trace-id': `web${crypto.randomUUID()}`,
        cookie: cookieHeader(cookiesFor(state, 'zomato.com')),
        'user-agent': BROWSER_UA,
        origin: 'https://www.zomato.com',
        referer: 'https://www.zomato.com/',
      },
      body: JSON.stringify({ cycle: 'current_cycle', postbackParams }),
    })
  } catch {
    return { alive: null, reason: 'probe_error' }
  }
  if (res.ok) return { alive: true }
  if (res.status === 401 || res.status === 403)
    return { alive: false, reason: 'lapsed', status: res.status }
  return { alive: null, reason: 'unexpected_status', status: res.status }
}

async function probeHyperpure(state: { cookies: StoredCookie[] }): Promise<ProbeResult> {
  const cookies = cookiesFor(state, 'hyperpure.com')
  const token = cookies.find((c) => c.name === 'token')?.value ?? null
  if (!token) return { alive: false, reason: 'no_session' }

  // The header set is Hyperpure's own, verified live on 2026-08-20 and again on
  // 2026-08-22: the token cookie already carries its `Bearer ` prefix and is
  // sent verbatim, and `deviceid` / `x-outletid` / a per-call tracking id are
  // required alongside it. Mirrors session.mjs createHyperpureSession.headers().
  const deviceId = cookies.find((c) => c.name === 'deviceId')?.value ?? ''
  const outletId =
    Deno.env.get('HYPERPURE_DELIVERY_OUTLET_ID') ||
    cookies.find((c) => c.name === 'outletId')?.value ||
    ''

  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    authorization: /^Bearer\s/i.test(token) ? token : `Bearer ${token}`,
    apiversion: '12.1',
    'x-client': 'consumer',
    'x-clientplatform': 'web',
    apptype: 'web',
    'x-appmode': 'STANDARD',
    headerroute: Deno.env.get('HYPERPURE_HEADER_ROUTE') || 'v2',
    'x-trackingid': crypto.randomUUID(),
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    origin: 'https://www.hyperpure.com',
    referer: 'https://www.hyperpure.com/',
  }
  if (deviceId) headers['deviceid'] = deviceId
  if (outletId) headers['x-outletid'] = String(outletId)

  let res: Response
  try {
    res = await fetch('https://api.hyperpure.com/consumer/accounts?source=HomePage', { headers })
  } catch {
    return { alive: null, reason: 'probe_error' }
  }
  if (res.ok) return { alive: true }
  if (res.status === 401 || res.status === 403)
    return { alive: false, reason: 'lapsed', status: res.status }
  return { alive: null, reason: 'unexpected_status', status: res.status }
}

/** Probe one channel's stored session with a single real authenticated call. */
export async function probeChannel(channel: string): Promise<ProbeResult> {
  const service = serviceClient()
  const { data, error } = await service.rpc('read_aggregator_session', { p_channel: channel })
  if (error) {
    console.error('probe could not read the session', error.code)
    return { alive: null, reason: 'backend_failure' }
  }
  if (!data) return { alive: false, reason: 'no_session' }
  const state = readState(data as string)
  if (!state) return { alive: false, reason: 'unusable_session' }
  return channel === 'hyperpure' ? probeHyperpure(state) : probeZomato(state)
}
