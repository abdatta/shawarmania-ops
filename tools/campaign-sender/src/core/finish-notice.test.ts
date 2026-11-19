// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { finishNoticeText } from './finish-notice.ts'

describe('the finished-campaign message', () => {
  it('says what was sent, and only the troubles there were', () => {
    expect(
      finishNoticeText('Weekend combo', {
        recipients: 418,
        sent: 412,
        notOnWhatsapp: 3,
        failed: 1,
        unsure: 0,
        stopped: 2,
      }),
    ).toBe(
      'Shawarmania campaign *Weekend combo* is finished. Sent to 412 of 418. 3 not on WhatsApp, 1 failed, 2 stopped.',
    )
    expect(
      finishNoticeText('New menu', {
        recipients: 5,
        sent: 5,
        notOnWhatsapp: 0,
        failed: 0,
        unsure: 0,
        stopped: 0,
      }),
    ).toBe('Shawarmania campaign *New menu* is finished. Sent to 5 of 5.')
  })
})
