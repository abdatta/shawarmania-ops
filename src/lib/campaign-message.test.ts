import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_MESSAGE_MAX,
  CAMPAIGN_NAME_MAX,
  campaignBodyProblem,
  campaignGreetingName,
  previewCampaignMessage,
  renderCampaignMessage,
  usesCampaignName,
} from '../../shared/campaign-message'

/**
 * The one function both halves of a campaign use
 * (a-campaign-goes-out-on-whatsapp, design D3): the bubble the partner sees
 * as they type, and the text the sender hands to WhatsApp.
 */

describe('renderCampaignMessage: {name}', () => {
  it('puts the saved name where {name} stands', () => {
    expect(renderCampaignMessage('Hi {name}, the new menu is here.', 'Moumita').text).toBe(
      `Hi Moumita, the new menu is here.`,
    )
  })

  it('fills every {name}, however a phone capitalised it', () => {
    expect(renderCampaignMessage('{Name}! Yes, { name }.', 'Arjun Das').text).toBe(
      `Arjun! Yes, Arjun.`,
    )
  })

  it('gives a customer with no saved name the greeting without one', () => {
    expect(renderCampaignMessage('Hi {name}, the new menu is here.', null).text).toBe(
      `Hi, the new menu is here.`,
    )
    expect(renderCampaignMessage('Hello {name}!', null).text).toBe(`Hello!`)
  })

  it('starts the line with a capital when the missing name opened it', () => {
    expect(renderCampaignMessage('{name}, your table is waiting.', null).text).toBe(
      `Your table is waiting.`,
    )
    expect(renderCampaignMessage('Offer!\n{name}: come by today.', '   ').text).toBe(
      `Offer!\nCome by today.`,
    )
  })

  it('leaves no empty bold behind when the missing name was formatted', () => {
    expect(renderCampaignMessage('Hi *{name}*, welcome back.', null).text).toBe(`Hi, welcome back.`)
  })

  it('keeps formatting characters inside a name from formatting the message', () => {
    // A name saved before #56 may be an order label, typed with anything in it.
    const { text } = renderCampaignMessage('Hi {name}, 20% off today.', '*Raj_ ~K~ `x`')
    expect(text).toBe(`Hi Raj, 20% off today.`)
    const [greeting] = previewCampaignMessage(text)
    expect(greeting).toEqual([{ text: 'Hi Raj, 20% off today.' }])
  })

  it('treats a name that is only formatting characters as no name', () => {
    expect(campaignGreetingName('**__**')).toBeNull()
    expect(renderCampaignMessage('Hi {name}!', '**')).toEqual({
      text: `Hi!`,
      tooLong: false,
    })
  })

  it('never lets a name carry a second {name} or a line break in', () => {
    expect(campaignGreetingName('{name}Ritika\nSen')).toBe('nameRitika')
  })

  it('cuts a very long saved name at the cap', () => {
    const long = 'A'.repeat(CAMPAIGN_NAME_MAX + 25)
    expect(campaignGreetingName(long)).toHaveLength(CAMPAIGN_NAME_MAX)
  })

  it('says whether a body greets by name at all', () => {
    expect(usesCampaignName('Hi {Name}')).toBe(true)
    expect(usesCampaignName('Hi there')).toBe(false)
  })
})

describe('campaignGreetingName: the first name, or none', () => {
  // A full saved name read like a bill ("Hi Debarati Roy!"), and initials or
  // two letters greeted nobody ("Hi S Ghosh!", "Hi ss!") [owner, 2026-11-24].
  it('greets by the first name alone', () => {
    expect(campaignGreetingName('Debarati Roy')).toBe('Debarati')
    expect(campaignGreetingName('Avijit Roy Chowdhury')).toBe('Avijit')
    expect(renderCampaignMessage('Hi {name}! 👋', 'Supratik De').text).toBe('Hi Supratik! 👋')
  })

  it('capitalises a name typed all in one case, and leaves a mixed one as typed', () => {
    expect(campaignGreetingName('argha')).toBe('Argha')
    expect(campaignGreetingName('ANU mitra')).toBe('Anu')
    expect(campaignGreetingName('McKenzie')).toBe('McKenzie')
  })

  it('looks past Md and Sk to the name after them', () => {
    expect(campaignGreetingName('Md Rafi')).toBe('Rafi')
    expect(campaignGreetingName('SK. imran ali')).toBe('Imran')
  })

  it('greets nobody by name for initials, a few letters or a title', () => {
    for (const saved of [
      'S Ghosh',
      'A K Sinha',
      'P. Samadder',
      'ss',
      'AA',
      'Oj',
      'Mr Bagchi',
      'Dr Sen',
      'u8uuu',
      'Md',
    ]) {
      expect(campaignGreetingName(saved)).toBeNull()
    }
    expect(renderCampaignMessage('Hi {name}! 👋', 'S Ghosh').text).toBe('Hi! 👋')
  })
})

describe('renderCampaignMessage: nothing added, and the length', () => {
  it('is the body, trimmed, with nothing added under it', () => {
    // Until 2026-11-20 a stop line was added under every message.
    expect(renderCampaignMessage('  New menu today.  \n\n', null).text).toBe('New menu today.')
    expect(renderCampaignMessage('Hi {name}', 'Moumita').text).not.toMatch(/STOP/i)
  })

  it('reports an over-long message and does not cut it', () => {
    const body = 'x'.repeat(CAMPAIGN_MESSAGE_MAX + 1)
    const rendered = renderCampaignMessage(body, null)
    expect(rendered.tooLong).toBe(true)
    // A message that long is refused, never cut.
    expect(rendered.text).toBe(body)
  })

  it('judges a body by the longest name it could be sent with', () => {
    const room = CAMPAIGN_MESSAGE_MAX
    // Fits with no name, and would not with a long one.
    const tight = `${'x'.repeat(room - '{name}'.length - 3)}{name}`
    expect(renderCampaignMessage(tight, null).tooLong).toBe(false)
    expect(campaignBodyProblem(tight)).toBe('too_long')
    expect(campaignBodyProblem('x'.repeat(room))).toBeNull()
    expect(campaignBodyProblem('x'.repeat(room + 1))).toBe('too_long')
  })

  it('refuses an empty body', () => {
    expect(campaignBodyProblem('  \n ')).toBe('empty')
  })
})

describe('previewCampaignMessage: WhatsApp formatting', () => {
  it('draws bold, italic, strikethrough and monospace', () => {
    expect(previewCampaignMessage('*Big* _soft_ ~old~ `code` plain')).toEqual([
      [
        { text: 'Big', bold: true },
        { text: ' ' },
        { text: 'soft', italic: true },
        { text: ' ' },
        { text: 'old', strike: true },
        { text: ' ' },
        { text: 'code', mono: true },
        { text: ' plain' },
      ],
    ])
  })

  it('nests one inside another', () => {
    expect(previewCampaignMessage('*20% _off_*')).toEqual([
      [
        { text: '20% ', bold: true },
        { text: 'off', bold: true, italic: true },
      ],
    ])
  })

  it('keeps each line, and a blank line as a blank line', () => {
    expect(previewCampaignMessage('One\n\nTwo')).toEqual([[{ text: 'One' }], [], [{ text: 'Two' }]])
  })

  it('leaves a marker alone where WhatsApp would', () => {
    // Inside a word, around a space, unclosed, or across a line.
    for (const text of ['2*3*4', '* not bold *', '*unclosed', 'snake_case_name', '5 ~ 6 ~ 7']) {
      expect(previewCampaignMessage(text)).toEqual([[{ text }]])
    }
    expect(previewCampaignMessage('*one\ntwo*')).toEqual([[{ text: '*one' }], [{ text: 'two*' }]])
  })

  it('formats nothing inside monospace', () => {
    expect(previewCampaignMessage('`*not bold*`')).toEqual([[{ text: '*not bold*', mono: true }]])
  })

  it('draws a three-backtick block across lines', () => {
    expect(previewCampaignMessage('Code:\n```A *1*\nB```')).toEqual([
      [{ text: 'Code:' }],
      [{ text: 'A *1*', mono: true }],
      [{ text: 'B', mono: true }],
    ])
  })

  it('never produces markup: what is typed is text', () => {
    expect(previewCampaignMessage('<b>*x*</b>')).toEqual([
      [{ text: '<b>' }, { text: 'x', bold: true }, { text: '</b>' }],
    ])
  })
})

describe('renderCampaignMessage: double asterisks', () => {
  // The first real campaign wrote its headline `**like this**`, as most apps
  // write bold; WhatsApp would have shown a stray `*` each side [owner, 2026-11-24].
  it('sends a pair of double asterisks as single ones', () => {
    expect(
      renderCampaignMessage(
        '🍯 **Something Sweet at SHAWARMANIA!** ❤️\n\nOur **NEW KUNAFA!** 😍',
        null,
      ).text,
    ).toBe('🍯 *Something Sweet at SHAWARMANIA!* ❤️\n\nOur *NEW KUNAFA!* 😍')
  })

  it('draws it bold in the bubble with no asterisk showing', () => {
    const { text } = renderCampaignMessage('Try **Kunafa** today', null)
    expect(previewCampaignMessage(text)).toEqual([
      [{ text: 'Try ' }, { text: 'Kunafa', bold: true }, { text: ' today' }],
    ])
  })

  it('works beside a filled-in name and at the start of a line', () => {
    expect(renderCampaignMessage('**Hi {name}**,\n**New** here', 'Riya').text).toBe(
      '*Hi Riya*,\n*New* here',
    )
  })

  it('leaves asterisks alone that WhatsApp would not read as a pair', () => {
    for (const body of ['5 ** 2', 'a lone ** here', '** spaced **', 'x**y**z', '**one\ntwo**']) {
      expect(renderCampaignMessage(body, null).text).toBe(body)
    }
  })

  it('leaves asterisks inside monospace alone', () => {
    expect(renderCampaignMessage('`**raw**` and ```\n**block**\n```', null).text).toBe(
      '`**raw**` and ```\n**block**\n```',
    )
  })

  it('leaves single-asterisk bold as it was', () => {
    expect(renderCampaignMessage('*Already bold*', null).text).toBe('*Already bold*')
  })
})
