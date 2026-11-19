// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { isLidJid, isStopReply, phoneOfJid, senderPhone } from './stop-reply.ts'

describe('a reply of STOP', () => {
  it.each(['STOP', 'stop', 'Stop', '  stop \n', 'sToP'])('is %j', (text) => {
    expect(isStopReply(text)).toBe(true)
  })

  it.each(['stop please', 'please stop', 'STOP!', 'stopp', 'unstop', '', null, undefined])(
    'is not %j: only the whole message counts',
    (text) => {
      expect(isStopReply(text)).toBe(false)
    },
  )
})

describe('whose reply it is', () => {
  it('reads a number from a chat named by number, with or without a device', () => {
    expect(phoneOfJid('919000008401@s.whatsapp.net')).toBe('919000008401')
    expect(phoneOfJid('919000008401:3@s.whatsapp.net')).toBe('919000008401')
    expect(phoneOfJid('1234@g.us')).toBeNull()
    expect(phoneOfJid('5554433@lid')).toBeNull()
    expect(phoneOfJid('status@broadcast')).toBeNull()
  })

  it('takes the number beside a LID, and never a LID itself', () => {
    expect(isLidJid('84828372000@lid')).toBe(true)
    expect(
      senderPhone({ remoteJid: '84828372000@lid', remoteJidAlt: '919000008401@s.whatsapp.net' }),
    ).toBe('919000008401')
    expect(senderPhone({ remoteJid: '84828372000@lid' })).toBeNull()
    expect(
      senderPhone({ remoteJid: '84828372000@lid', remoteJidAlt: '84828372001@lid' }),
    ).toBeNull()
  })

  it('is nobody for the account’s own messages, groups and broadcasts', () => {
    expect(senderPhone({ remoteJid: '919000008401@s.whatsapp.net', fromMe: true })).toBeNull()
    expect(senderPhone({ remoteJid: '120363000000000000@g.us' })).toBeNull()
    expect(senderPhone({ remoteJid: 'status@broadcast' })).toBeNull()
    expect(senderPhone({ remoteJid: '919000008401@s.whatsapp.net' })).toBe('919000008401')
  })
})
