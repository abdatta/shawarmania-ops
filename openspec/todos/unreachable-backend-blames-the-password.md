# Unreachable Backend Blames The Password

**Type**: Defect · **Status**: Open · **Area**: Auth

## Expectation

When the app cannot reach its backend at all, sign-in says so. Somebody on a bad connection should be told the connection is the problem, not that they typed their password wrong.

## Current behaviour

`signIn` in [`src/data-access/auth.ts`](../../src/data-access/auth.ts) maps **every** failure to one message:

```ts
if (error || !data.user) {
  throw new SignInError('invalid_credentials', 'That email or password is not right.')
}
```

`signInWithPassword` returns an error for a wrong password, an unknown address, a rate limit, a DNS failure, a refused connection and a timeout alike. All six become *"That email or password is not right."*

Found the hard way on 2026-07-27: a local build was accidentally pointed at a host that does not exist, and the screen insisted — accurately-looking, four times over — that a correct password was wrong. Nobody would think to check the network, because the app had already named a different cause.

## Why the current behaviour is not simply a bug to delete

The uniformity is deliberate and must survive. `auth-and-roles` (#4) gives a wrong address and a wrong password the same answer on purpose: telling them apart would confirm which addresses have accounts, which is exactly the enumeration this app refuses to offer. Any fix has to keep those two indistinguishable.

## Why a transport failure is different

It describes the **request**, not any account. "We could not reach the server" reveals nothing about whether an address exists, whether a password was close, or whether anybody is registered at all — the same reasoning that lets `weak_password` and `rate_limited` be specific on the activation endpoint (#16 design D6). A caller who cannot reach the host learns nothing by being told so, because they could observe it themselves.

## Shape of the fix

- Distinguish a transport failure — no HTTP response at all — from an authentication refusal. supabase-js surfaces these differently; `AuthRetryableFetchError` and a status of `0`/absent are the signal, not the message text.
- A third `SignInError` code, something like `unreachable`, with copy that names the connection and suggests trying again.
- Leave `invalid_credentials` covering wrong-address and wrong-password exactly as it does now.
- The same treatment likely belongs on activation, which has the same shape (`ActivationError('unavailable')` already exists there and is simply never reached, since the adapter swallows the distinction earlier).

## Why it matters beyond a wasted afternoon

The counter tablets and staff phones run on shop wifi and mobile data in Kalyani. A dropped connection at the start of a shift is an ordinary event, and the app currently responds to it by telling an employee their password is wrong — which sends them to their manager for a code they do not need, and makes the real fault invisible.
