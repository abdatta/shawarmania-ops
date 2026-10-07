# Design: the-menu-asks-for-a-review

## D1. Three columns on the outlet, written through one narrow function

`review_ask_enabled`, `review_ask_url`, `review_ask_percent` on `outlets`, as #60's
service settings and #62's loyalty rules are, and written only through
`set_outlet_review_ask`, which re-derives the caller's authority (owner, or a
Franchise Admin of the outlet, on a live account) and touches these three columns
and no others. `outlets_update` stays the owner's alone for everything else.

The table refuses, whatever the caller: an ask with no link
(`outlets_review_ask_needs_url`), a link that is not `https://` or that holds
whitespace, a quote or an angle bracket (`outlets_review_ask_url_shape`, because
the Worker writes it into an `href` on a public page), and a percentage outside
1–50 (`outlets_review_ask_percent_range`). The link and percentage are kept while
the ask is off, so switching it back on starts where the outlet left it.

## D2. `public_menu` answers `review` or null

The reader adds one top-level key: `{url, percent}` while the outlet asks, null
while it does not. Null rather than absent keeps the payload's shape the same for
every outlet. The sections are #68's, unchanged.

The brand site's Worker allowlists `review`, `url` and `percent` and nothing else
new, and treats a missing key — an ops that predates this change — as off.

## D3. The words are a thank-you, not a price [owner, 2026-10-07]

The owner asked that the popup not look like paying for reviews. The site's copy
asks how the meal was, says feedback helps the cafe improve, asks for an *honest*
review, says "good or bad, we read every one", and names the percentage as "our
thank-you". It never asks for stars or a positive review. This repo holds only
the number; the wording is the site's (`worker/src/menu-page.ts`).

The ops side says it plainly [owner, 2026-10-07]: **Review popup on the menu** and
**Review discount**. Warm wording belongs only where customers read it.

## D4. The percentage is not applied automatically

A customer shows their review at the counter and the biller applies the ordinary
bill discount. Making it a preset or a typed discount source was considered and
left out: it would need a new discount-row source and its arithmetic cases for a
discount the counter already knows how to give by hand.
