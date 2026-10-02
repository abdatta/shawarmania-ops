import { describe, expect, it } from 'vitest'

import { receiptMessage, whatsappChatLink } from './whatsapp-link'

const RECEIPT = 'https://shawarmania.in/bill?t=Ab3-_x9QzT'

describe('a WhatsApp chat link', () => {
  it('names the number in international form, with no plus', () => {
    expect(whatsappChatLink('+919876543210', 'hello')).toBe('https://wa.me/919876543210?text=hello')
  })

  it('carries line breaks and the receipt URL through the text parameter intact', () => {
    const message = `Line one\nLine two\n${RECEIPT}?a=1&b=2#x`
    const link = new URL(whatsappChatLink('+919876543210', message))

    expect(link.search).toContain('%0A')
    expect(link.searchParams.get('text')).toBe(message)
  })

  /*
   * The caller hands over a bill's canonical phone, never a raw one. A raw value
   * turned into a link by stripping characters would be a guess, and a guessed
   * digit sends a stranger somebody's bill.
   */
  it.each(['9876543210', '919876543210', '+91 98765 43210', '+9198765432', ''])(
    'refuses %j, which is not a canonical phone',
    (phone) => {
      expect(() => whatsappChatLink(phone, 'hello')).toThrow()
    },
  )
})

describe('the receipt message', () => {
  const message = receiptMessage({ billNumber: 1489, totalPaise: 26000, receiptUrl: RECEIPT })

  it('names the bill and its total', () => {
    expect(message).toContain('1489')
    expect(message).toContain('₹260')
  })

  it('ends with the receipt link on its own line, so a preview is built from it', () => {
    const lines = message.split('\n')
    expect(lines.at(-1)).toBe(RECEIPT)
  })

  it('offers nothing and names nobody', () => {
    expect(message).not.toMatch(/point|offer|discount|gold/i)
    expect(message).not.toMatch(/\bHi\b/)
  })

  it('formats paise as the app does everywhere else', () => {
    expect(receiptMessage({ billNumber: 7, totalPaise: 12345650, receiptUrl: RECEIPT })).toContain(
      '₹1,23,456.50',
    )
  })
})
