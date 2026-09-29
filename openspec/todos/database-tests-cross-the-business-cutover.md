# Database tests cross the business cutover

**Type**: Verification gap · **Status**: Open, narrowed 2026-09-29 · **Area**: Testing

The local verification suite should give the same result throughout the day. During Overview verification on 2026-09-08, a previously green database run failed receipt fixtures between 04:00 IST and midnight UTC: a fixture labelled a bill with UTC `current_date`, but its timestamp belonged to the next outlet business date.

**Taken by `the-suite-gives-the-same-answer-all-day`.** The fixtures, the seed's intraday timeline and the authenticated two-tablet test now take their business date from the instant they stamp, and the database suite, the REST probes and the authenticated browser suite passed inside the window on 2026-09-28. That part is no longer open.

**What remains.** Leaving a seeded stack open across the outlet cutover expires its active shifts and makes later REST billing probes fail. A fresh reset resolves it, and it never affects a CI run, which always starts from a fresh stack. It is a different mechanism from the one above: the stack's shifts are genuinely over, not mislabelled.

Promote if a long local session crossing the cutover becomes a regular way of working: the likely shape is a check in the local verification commands that notices expired seeded shifts and says to reset, rather than any change to shift expiry itself.
