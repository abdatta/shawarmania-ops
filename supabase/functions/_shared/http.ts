/**
 * HTTP plumbing shared by both account functions.
 *
 * The permissive origin is safe here and only here: these endpoints are
 * authorised by a bearer token in a header, never by a cookie, so a browser
 * on another origin gains nothing by being allowed to send the request — it
 * would still have to already hold the token. Nothing in this app uses cookie
 * auth; if that ever changes, this is the line that has to change with it.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

/** Parses a JSON body, returning undefined rather than throwing on garbage. */
export async function readJson(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await req.json()
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** A trimmed non-empty string, or undefined. Keeps validation honest at the edge. */
export function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
