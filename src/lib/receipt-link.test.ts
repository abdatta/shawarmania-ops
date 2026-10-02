import { describe, expect, it } from 'vitest'

import {
  demoReceiptToken,
  isDemoReceiptLink,
  isDemoReceiptToken,
  PRODUCTION_RECEIPT_BASE_URL,
  receiptLink,
  resolveReceiptBaseUrl,
} from './receipt-link'

/** The dynamic URL registered on Airtel DLT, up to and including its `?`. */
const REGISTERED_DLT_URL = 'https://shawarmania.in/bill?'

describe('where receipts are served', () => {
  /*
   * Asserted through `resolveReceiptBaseUrl` rather than through the exported
   * constant, because the constant reads `import.meta.env` -- so a test over it
   * is a test of whoever last edited `.env`. That is not hypothetical: pointing
   * a local `.env` at a Worker on 8787 for browsing turned this assertion red.
   */
  it('is the brand site when nothing is configured', () => {
    expect(resolveReceiptBaseUrl(undefined)).toBe('https://shawarmania.in')
    expect(resolveReceiptBaseUrl('')).toBe(PRODUCTION_RECEIPT_BASE_URL)
    expect(resolveReceiptBaseUrl('   ')).toBe(PRODUCTION_RECEIPT_BASE_URL)
  })

  it('is whatever is configured, so the Worker can be reached before the apex route exists', () => {
    expect(resolveReceiptBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(resolveReceiptBaseUrl(' https://receipts.example.workers.dev ')).toBe(
      'https://receipts.example.workers.dev',
    )
  })
})

describe('receiptLink', () => {
  it('points at the brand site, not at this app', () => {
    expect(receiptLink('Ab3-_x9QzT', PRODUCTION_RECEIPT_BASE_URL)).toBe(
      'https://shawarmania.in/bill?t=Ab3-_x9QzT',
    )
  })

  /*
   * The reason for the shape (a-receipt-link-fits-an-sms). An SMS link is
   * validated against a dynamic URL registered on DLT up to its `?`, and only what
   * follows may vary. So everything before the `?` is the same for every bill.
   */
  it('carries the token after a question mark, behind the prefix registered on DLT', () => {
    const a = receiptLink('Ab3-_x9QzT', PRODUCTION_RECEIPT_BASE_URL)!
    const b = receiptLink('Zz9_-kQ0aB', PRODUCTION_RECEIPT_BASE_URL)!
    expect(a.startsWith(REGISTERED_DLT_URL)).toBe(true)
    expect(b.startsWith(REGISTERED_DLT_URL)).toBe(true)
    expect([...new URL(a).searchParams.keys()]).toEqual(['t'])
  })

  it('takes a base so the Worker can be exercised before the apex route exists', () => {
    expect(receiptLink('Ab3-_x9QzT', 'https://receipts.example.workers.dev')).toBe(
      'https://receipts.example.workers.dev/bill?t=Ab3-_x9QzT',
    )
  })

  it('tolerates a base with a trailing slash rather than producing a double one', () => {
    expect(receiptLink('Ab3-_x9QzT', 'https://shawarmania.in/')).toBe(
      'https://shawarmania.in/bill?t=Ab3-_x9QzT',
    )
  })

  /*
   * A bill still in a tablet's outbox has no token, because the link is minted
   * when the row reaches Postgres. That is a real state, not an error: nobody
   * can hand out a link to a bill the server has not accepted, and the surface
   * shows nothing rather than a URL that would refuse.
   */
  it('has no link for a bill the server has not accepted yet', () => {
    expect(receiptLink(null)).toBeNull()
    expect(receiptLink(undefined)).toBeNull()
    expect(receiptLink('')).toBeNull()
  })
})

describe('demoReceiptToken', () => {
  it('reads as a link, so a demonstration walks the whole story', () => {
    expect(receiptLink(demoReceiptToken(1247), PRODUCTION_RECEIPT_BASE_URL)).toBe(
      'https://shawarmania.in/bill?t=demo~1247',
    )
  })

  /*
   * The load-bearing property, and the reason the shape is `demo~` rather than
   * something merely improbable. Minted tokens are base64url — letters, digits,
   * `-` and `_` — which contains no `~`. So a demo token cannot equal a real
   * one by construction, not by luck, and a demo can never hand out a URL that
   * resolves to somebody's actual bill.
   */
  it('cannot collide with a minted token, because base64url has no tilde', () => {
    const demo = demoReceiptToken(1247)
    expect(demo).toContain('~')
    expect(demo).not.toMatch(/^[A-Za-z0-9_-]+$/)
    expect(isDemoReceiptToken(demo)).toBe(true)
    expect(isDemoReceiptToken('Ab3-_x9QzT')).toBe(false)
  })
})

describe('spotting a link that will not open', () => {
  /*
   * Read off the URL rather than from the session, so the warning shown to a
   * person cannot disagree with what the public reader will do with the token.
   */
  it('recognises a demo link at any base', () => {
    expect(isDemoReceiptLink('https://shawarmania.in/bill?t=demo~1247')).toBe(true)
    expect(isDemoReceiptLink('http://127.0.0.1:8787/bill?t=demo~26')).toBe(true)
  })

  it('recognises one the counter has asked for its own view of', () => {
    expect(isDemoReceiptLink('https://shawarmania.in/bill?t=demo~26&view=counter')).toBe(true)
  })

  it('recognises every demo link the app builds', () => {
    expect(isDemoReceiptLink(receiptLink(demoReceiptToken(26), PRODUCTION_RECEIPT_BASE_URL)!)).toBe(
      true,
    )
  })

  it('leaves a real link alone', () => {
    expect(isDemoReceiptLink('https://shawarmania.in/bill?t=Ab3-_x9QzT')).toBe(false)
    expect(isDemoReceiptLink('https://shawarmania.in/bill?t=demonstrative')).toBe(false)
  })

  it('survives the tilde arriving percent-encoded', () => {
    // `receiptLink` runs the token through `encodeURIComponent`, which leaves
    // `~` alone today — but it is unreserved rather than guaranteed, so this
    // does not depend on that staying true.
    expect(isDemoReceiptLink('https://shawarmania.in/bill?t=demo%7E26')).toBe(true)
  })

  it('is false for something that is not a receipt link at all', () => {
    expect(isDemoReceiptLink('https://shawarmania.in/')).toBe(false)
    expect(isDemoReceiptLink('https://shawarmania.in/menu/?t=demo~26')).toBe(false)
    expect(isDemoReceiptLink('not a url')).toBe(false)
  })
})

describe('the receipt message the link goes out in', () => {
  /*
   * The template registered on DLT (a-receipt-link-fits-an-sms, design D6), filled
   * in. It lives on the operator's portal, not in this repository, so this is a
   * copy; what it guards is the link's share of the length. A base or a token
   * that grows enough to push the message into a second segment doubles the
   * cost of every receipt, and nothing else would say so.
   */
  /*
   * The ASCII half of GSM-7's basic set: printable ASCII less `[\]^`{|}~`, which
   * are either extension characters (two septets each) or absent. One character
   * outside it sends the whole message as UCS-2, at 70 characters a segment.
   */
  const GSM7_BASIC_ASCII = /^[\n !"#$%&'()*+,\-./0-9:;<=>?@A-Z_a-z]*$/

  function filled(earned: number, balance: number, token: string): string {
    return [
      'Thank you for visiting Shawarmania!',
      `You earned ${earned} points. Balance: ${balance} points.`,
      `Receipt: ${receiptLink(token, PRODUCTION_RECEIPT_BASE_URL)}`,
    ].join('\n')
  }

  it('fits one SMS at a ten-character token and a four-digit balance', () => {
    const message = filled(20, 1250, 'Ab3-_x9QzT')
    expect(message.length).toBeLessThanOrEqual(160)
    expect(message).toMatch(GSM7_BASIC_ASCII)
  })

  it('still fits with a five-digit balance and a token minted at fourteen characters', () => {
    expect(filled(999, 99999, 'Ab3-_x9QzTk2Lm').length).toBeLessThanOrEqual(160)
  })
})
