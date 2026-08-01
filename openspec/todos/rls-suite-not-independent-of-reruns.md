# `test:rls` is not independent of a previous run

**Type**: Verification gap · **Status**: Open · **Area**: Testing

## What happens

Run `npm run test:rls` twice inside fifteen minutes without a `db reset`
between, and the second run fails four or five activation tests with `429`
(rate limited) instead of `204`/`200`.

Nothing is broken. `invite_redemption_attempts` accumulates **failed**
activation attempts and `invite_attempts_exceeded` bounds them globally at 500
per rolling quarter hour — deliberately, and documented as deliberate in
`20260727000005_activation_without_typing.sql`. The suite deliberately produces
failed attempts (wrong codes, expired codes, short passwords) to prove the
bound exists, so running it repeatedly spends the budget it is testing.

## Why it matters

CI never hits it: the `db` job starts a fresh stack every time. A developer
iterating on one probe hits it constantly, and the failure names rate limiting
rather than "you have run this before" — so the first reaction is to go looking
for a regression that is not there.

`09_outlet_and_staff_setup.sql` already made this argument for pgTAP and acted
on it: *"a suite that passes only on a fresh reset is a suite that will be
believed when it is wrong."* The REST suite has the same property and has not
had the same treatment.

## What already exists

- `record_invite_failure` prunes rows older than the window opportunistically.
- `invite_failure_pressure(interval)` reads the count, Super-Admin only.
- The pgTAP suites solve their own version of this by wrapping everything in a
  transaction that rolls back; the REST suite cannot, because it goes through
  PostgREST over HTTP.

## Options, none costed

- Clear `invite_redemption_attempts` in the REST suite's global setup, the way
  `09` clears today's attendance — explicit, scoped, and obviously test setup.
- Give the bound a much larger ceiling when the request carries a known test
  marker — rejected on sight if it means a production code path reading a
  header, which is how rate limits get defeated for real.
- Leave it and document it in `docs/TESTING.md`, which is the cheapest and
  weakest option.

## Trigger

Whenever somebody loses time to it, or when `test:rls` grows enough
activation cases that a single run approaches the bound on its own.
