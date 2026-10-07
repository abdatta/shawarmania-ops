/**
 * An outlet's Google review ask (the-menu-asks-for-a-review).
 *
 * The public table menu at `shawarmania.in/menu/<slug>/` opens with a popup
 * asking the customer to share a review on Google, with a thank-you discount
 * for sharing it. Each outlet decides whether it asks, where its own listing
 * takes a review, and how large the thank-you is.
 *
 * **The percentage is words, not arithmetic.** It is what the menu promises; the
 * biller gives it at the counter with the outlet's ordinary bill discount, as for
 * any other discount the counter applies by hand. Nothing here touches a bill.
 */
export interface OutletReviewAsk {
  enabled: boolean
  /** Where the outlet's Google listing takes a review, e.g. `https://g.page/r/<id>/review`. */
  url: string | null
  /** The thank-you, in whole percent. */
  percent: number
}

export const MIN_REVIEW_PERCENT = 1
export const MAX_REVIEW_PERCENT = 50

/** What every outlet starts with: not asking, and five percent ready for when it does. */
export const DEFAULT_REVIEW_ASK: Readonly<OutletReviewAsk> = Object.freeze({
  enabled: false,
  url: null,
  percent: 5,
})

/** The database's `outlets_review_ask_url_shape`, as the form says it. */
export const REVIEW_URL_PATTERN = /^https:\/\/[^\s"<>]+$/
export const REVIEW_URL_MAX_LENGTH = 500

export type ReviewAskProblem = 'url_required' | 'url_invalid' | 'percent_out_of_range'

export const REVIEW_ASK_PROBLEM_MESSAGES: Record<ReviewAskProblem, string> = {
  url_required: 'Paste the outlet’s Google review link to ask for reviews.',
  url_invalid: 'Use the review link exactly as Google gives it, starting with https://.',
  percent_out_of_range: `The thank-you is a whole number from ${MIN_REVIEW_PERCENT} to ${MAX_REVIEW_PERCENT} percent.`,
}

/** Why the database would refuse this ask, or null when it would store it. */
export function reviewAskProblem(ask: OutletReviewAsk): ReviewAskProblem | null {
  const url = ask.url?.trim() ?? ''
  if (url !== '' && (url.length > REVIEW_URL_MAX_LENGTH || !REVIEW_URL_PATTERN.test(url))) {
    return 'url_invalid'
  }
  if (ask.enabled && url === '') return 'url_required'
  if (
    !Number.isInteger(ask.percent) ||
    ask.percent < MIN_REVIEW_PERCENT ||
    ask.percent > MAX_REVIEW_PERCENT
  ) {
    return 'percent_out_of_range'
  }
  return null
}
