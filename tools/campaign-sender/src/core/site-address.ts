/**
 * Which database the app at an address talks to, read from the app itself.
 *
 * Signing the sender in to staging or to production should not need anybody
 * to find and paste a project's address and key. Every published build of the
 * app carries both in its script, because every browser needs them: the
 * database's address and its public key, which lets nobody do anything until
 * they sign in. So \`npm run sign-in -- staging\` reads them from the staging
 * site, and \`-- production\` from the production one, exactly as a browser
 * would.
 *
 * The key is accepted only if it says it is the public one, and is for the
 * same project as the address beside it; or, for the newer publishable kind of
 * key, which names no project, if the script carries exactly one. Text in,
 * text out.
 */

export const SITES = {
  staging: 'https://stage-ops.shawarmania.in/',
  production: 'https://ops.shawarmania.in/',
} as const

export type SiteName = keyof typeof SITES

export interface SiteAddress {
  url: string
  anonKey: string
}

/** The script files a page loads, as full addresses. */
export function scriptsOfPage(html: string, page: string): string[] {
  return [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(
    (match) => new URL(match[1] as string, page).href,
  )
}

function payloadOf(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1] ?? ''
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The address and public key a script carries, or null when it does not
 * carry exactly one project's.
 */
export function addressInScript(script: string): SiteAddress | null {
  const urls = [...new Set(script.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/g) ?? [])]
  if (urls.length !== 1) return null
  const url = urls[0] as string
  const ref = url.slice('https://'.length, -'.supabase.co'.length)
  const tokens = [
    ...new Set(
      script.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) ?? [],
    ),
  ]
  const anonKey = tokens.find((token) => {
    const payload = payloadOf(token)
    return payload?.['role'] === 'anon' && payload['ref'] === ref
  })
  if (anonKey) return { url, anonKey }
  // The newer kind of public key, which names no project: taken only when the
  // script carries exactly one.
  const publishable = [...new Set(script.match(/sb_publishable_[A-Za-z0-9_-]{10,}/g) ?? [])]
  return publishable.length === 1 ? { url, anonKey: publishable[0] as string } : null
}
