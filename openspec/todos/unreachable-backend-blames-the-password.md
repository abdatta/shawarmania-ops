# Unreachable Backend Blames The Password

**Type**: Defect · **Status**: Open · **Area**: Auth

## Expectation

When the app cannot reach its backend at all, sign-in says so. Somebody on a bad connection should be told the connection is the problem, not that they typed their password wrong.

## Behaviour that survives #24

`signIn` in [`src/data-access/auth.ts`](../../src/data-access/auth.ts) maps
**every** provider failure to `invalid_credentials`.

`username-sign-in-and-owner-recovery` (#24) changes the visible identifier, not
that classification. Afterwards, `signInWithPassword` can return an error for a
wrong password, an unknown username, a rate limit, a DNS failure, a refused
connection, or a timeout. Without this fix, all six become *“That username or
password is not right.”*

Found the hard way on 2026-07-27: a local build was accidentally pointed at a host that does not exist, and the screen insisted — accurately-looking, four times over — that a correct password was wrong. Nobody would think to check the network, because the app had already named a different cause.

## Why the current behaviour is not simply a bug to delete

The uniformity is deliberate and must survive. The identity contract gives an
unknown username and a wrong password the same answer on purpose: telling them
apart would confirm which usernames have accounts. Any fix has to keep those
two indistinguishable.

## Why a transport failure is different

It describes the **request**, not any account. “We could not reach the server”
reveals nothing about whether a username exists, whether a password was close,
or whether anybody is registered at all — the same reasoning that lets
`weak_password` and `rate_limited` be specific on activation. A caller who
cannot reach the host learns nothing by being told so, because they could
observe it themselves.

## Shape of the fix

- Distinguish a transport failure — no HTTP response at all — from an authentication refusal. supabase-js surfaces these differently; `AuthRetryableFetchError` and a status of `0`/absent are the signal, not the message text.
- A third `SignInError` code, something like `unreachable`, with copy that names the connection and suggests trying again.
- Leave `invalid_credentials` covering unknown-username and wrong-password
  exactly as the #24 contract requires.
- The same treatment likely belongs on activation, which has the same shape (`ActivationError('unavailable')` already exists there and is simply never reached, since the adapter swallows the distinction earlier).

## Why it matters beyond a wasted afternoon

The counter tablets and staff phones run on shop wifi and mobile data in Kalyani. A dropped connection at the start of a shift is an ordinary event, and the app currently responds to it by telling an employee their password is wrong — which sends them to their manager for a code they do not need, and makes the real fault invisible.

**Dependency when seeded**: `username-sign-in-and-owner-recovery` (#24), unless
that change deliberately absorbs this fix while rewriting sign-in.
