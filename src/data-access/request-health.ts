/**
 * How this device is talking to the server, over the last minute
 * (a-release-can-be-switched-off, D13).
 *
 * Installed on the one Supabase client. Per request it keeps the time it finished, whether it
 * failed and how long it took — **never the URL's query, a header or a body**,
 * so no phone number, name, amount or order can reach a report. The counting is
 * wrapped so that its own failure can never fail, slow or change a request.
 */

export const HEALTH_WINDOW_MS = 60_000

export interface HealthWindow {
  windowSeconds: number
  requests: number
  failed: number
  slowestMs: number
}

interface Sample {
  at: number
  failed: boolean
  ms: number
}

/** A response the server could not or would not serve: what the owner should see. */
export function isFailure(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

/**
 * The resource a request was for, from its path alone — `rest/v1/bills`,
 * `rest/v1/rpc/set_change_gate`, `functions/v1/counter-devices`, `auth` — and
 * nothing after it. Kept for tests and for a later per-resource breakdown; the
 * report itself carries only counts.
 */
export function resourceOf(url: string): string {
  try {
    const path = new URL(url).pathname
    if (path.startsWith('/auth/')) return 'auth'
    const match = path.match(/^\/(rest\/v1\/rpc|rest\/v1|functions\/v1|storage\/v1)\/([^/]+)/)
    return match ? `${match[1]}/${match[2]}` : 'other'
  } catch {
    return 'other'
  }
}

export class RequestHealth {
  private samples: Sample[] = []

  constructor(private readonly now: () => number = () => Date.now()) {}

  record(failed: boolean, ms: number): void {
    const at = this.now()
    this.samples.push({ at, failed, ms: Math.max(0, Math.round(ms)) })
    this.prune(at)
  }

  window(): HealthWindow {
    this.prune(this.now())
    return {
      windowSeconds: HEALTH_WINDOW_MS / 1000,
      requests: this.samples.length,
      failed: this.samples.filter((sample) => sample.failed).length,
      slowestMs: this.samples.reduce((slowest, sample) => Math.max(slowest, sample.ms), 0),
    }
  }

  private prune(now: number): void {
    const cutoff = now - HEALTH_WINDOW_MS
    if (this.samples.length > 0 && this.samples[0]!.at < cutoff) {
      this.samples = this.samples.filter((sample) => sample.at >= cutoff)
    }
  }
}

/** The one counter this page's client feeds, when health counting is installed. */
export const deviceRequestHealth = new RequestHealth()

/**
 * `fetch`, counted. The request and its response pass through untouched; a
 * thrown request is counted as failed and thrown again.
 */
export function instrumentFetch(
  base: typeof fetch,
  health: Pick<RequestHealth, 'record'>,
  clock: () => number = () => performance.now(),
): typeof fetch {
  const safely = (failed: boolean, started: number) => {
    try {
      health.record(failed, clock() - started)
    } catch {
      // Counting must never change what the request does.
    }
  }
  return async (input, init) => {
    const started = clock()
    try {
      const response = await base(input, init)
      safely(isFailure(response.status), started)
      return response
    } catch (cause) {
      safely(true, started)
      throw cause
    }
  }
}
