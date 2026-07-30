import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const GENERIC_FAILURE =
  'Production auth readiness failed; the username backend rollout is incomplete.'

export async function checkProductionAuthReadiness({ supabaseUrl, anonKey, fetchImpl = fetch }) {
  if (!supabaseUrl || !anonKey) {
    throw new Error('Production auth readiness needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  let endpoint
  try {
    endpoint = new URL('/functions/v1/email-sign-in', supabaseUrl)
  } catch {
    throw new Error(GENERIC_FAILURE)
  }

  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'deployment-readiness' }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error(GENERIC_FAILURE)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ready !== true) throw new Error(GENERIC_FAILURE)
}

async function main() {
  await checkProductionAuthReadiness({
    supabaseUrl: process.env['VITE_SUPABASE_URL'],
    anonKey: process.env['VITE_SUPABASE_ANON_KEY'],
  })
  console.log('Production auth readiness confirmed.')
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : GENERIC_FAILURE)
    process.exitCode = 1
  })
}
