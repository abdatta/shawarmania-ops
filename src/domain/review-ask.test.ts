import { describe, expect, it } from 'vitest'

import { DEFAULT_REVIEW_ASK, reviewAskProblem } from './review-ask'

const link = 'https://g.page/r/Cef3CrZy-ZyuEBE/review'

describe('an outlet’s Google review ask', () => {
  it('starts off, with five percent ready for when it is turned on', () => {
    expect(DEFAULT_REVIEW_ASK).toEqual({ enabled: false, url: null, percent: 5 })
    expect(reviewAskProblem(DEFAULT_REVIEW_ASK)).toBeNull()
  })

  it('needs somewhere to send the customer before it asks', () => {
    expect(reviewAskProblem({ enabled: true, url: null, percent: 5 })).toBe('url_required')
    expect(reviewAskProblem({ enabled: true, url: '   ', percent: 5 })).toBe('url_required')
    expect(reviewAskProblem({ enabled: true, url: link, percent: 5 })).toBeNull()
  })

  it('takes only an https link a page cannot be tricked by, as the database does', () => {
    expect(reviewAskProblem({ enabled: false, url: 'http://g.page/r/x/review', percent: 5 })).toBe(
      'url_invalid',
    )
    expect(
      reviewAskProblem({ enabled: true, url: 'https://g.page/r/x" onclick="y', percent: 5 }),
    ).toBe('url_invalid')
    expect(reviewAskProblem({ enabled: true, url: `  ${link}  `, percent: 5 })).toBeNull()
  })

  it('keeps the review discount a whole number from one to fifty percent', () => {
    for (const percent of [0, 51, 2.5, Number.NaN]) {
      expect(reviewAskProblem({ enabled: true, url: link, percent })).toBe('percent_out_of_range')
    }
    for (const percent of [1, 5, 50]) {
      expect(reviewAskProblem({ enabled: true, url: link, percent })).toBeNull()
    }
  })
})
