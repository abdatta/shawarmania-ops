// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { addressInScript, scriptsOfPage } from './site-address.ts'

const token = (payload: object) =>
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJlLW5vdC1jaGVja2VkLWhlcmU`

const REF = 'abcdefghijklmnopqrst'
const URL_ = `https://${REF}.supabase.co`

describe('reading a published app for its database', () => {
  it('finds the scripts a page loads, as full addresses', () => {
    const html = `<html><script type="module" crossorigin src="/shawarmania-ops/assets/index-X1.js"></script>
      <script src="https://cdn.example/x.js"></script></html>`
    expect(scriptsOfPage(html, 'https://stage-ops.shawarmania.in/')).toEqual([
      'https://stage-ops.shawarmania.in/shawarmania-ops/assets/index-X1.js',
      'https://cdn.example/x.js',
    ])
  })

  it('takes the address and its public key', () => {
    const anon = token({ iss: 'supabase', ref: REF, role: 'anon' })
    expect(addressInScript(`const a="${URL_}",b="${anon}";`)).toEqual({ url: URL_, anonKey: anon })
  })

  it('never takes a key that is not the public one, or is another project’s', () => {
    const service = token({ iss: 'supabase', ref: REF, role: 'service_role' })
    const other = token({ iss: 'supabase', ref: 'zzzzzzzzzzzzzzzzzzzz', role: 'anon' })
    expect(addressInScript(`"${URL_}" "${service}"`)).toBeNull()
    expect(addressInScript(`"${URL_}" "${other}"`)).toBeNull()
  })

  it('takes the newer publishable key, when the script carries just one', () => {
    expect(addressInScript(`"${URL_}" "sb_publishable_AbCdEfGhIjKlMnOp_123"`)).toEqual({
      url: URL_,
      anonKey: 'sb_publishable_AbCdEfGhIjKlMnOp_123',
    })
    expect(
      addressInScript(
        `"${URL_}" "sb_publishable_AbCdEfGhIjKlMnOp_1" "sb_publishable_AbCdEfGhIjKlMnOp_2"`,
      ),
    ).toBeNull()
    expect(addressInScript(`"${URL_}" "sb_secret_AbCdEfGhIjKlMnOp_123"`)).toBeNull()
  })

  it('takes nothing from a script that names two projects, or none', () => {
    const anon = token({ ref: REF, role: 'anon' })
    expect(
      addressInScript(`"${URL_}" "https://bbbbbbbbbbbbbbbbbbbb.supabase.co" "${anon}"`),
    ).toBeNull()
    expect(addressInScript(`"${anon}"`)).toBeNull()
  })
})
