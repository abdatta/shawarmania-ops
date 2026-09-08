# Database tests cross the business cutover

**Type**: Verification gap · **Status**: Open · **Area**: Testing

The local verification suite should give the same result throughout the day. During Overview verification on 2026-09-08, a previously green database run failed receipt fixtures between 04:00 IST and midnight UTC: a fixture labelled a bill with UTC `current_date`, but its timestamp belonged to the next outlet business date. Receipt suites 50–52 reproduced this on a fresh reset. Changing the connection timezone merely moved failures into attendance fixtures, so the timezone was restored to UTC.

Separately, leaving a seeded stack open across the outlet cutover expires its active shifts and makes later REST billing probes fail. A fresh reset resolves that case.

The authenticated two-tablet test has the same date issue: it opens the spare shift with `new Date().toISOString().slice(0, 10)` while the counter uses the outlet business date. Between cutover and UTC midnight, the spare's payment dialog remains open because its fixture shift belongs to the previous day.

Promote when maintaining the test harness: give each time-sensitive fixture a consistent explicit business date and timestamp, and prove the suite on both sides of the cutover. Preserve production date validation; do not weaken it to accommodate fixtures.
