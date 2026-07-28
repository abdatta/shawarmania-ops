# Tasks: activation-without-typing

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first. Decision
> references below (D1–D13) are to that design.

## 1. The database: code becomes the key

- [x] 1.1 New forward-only migration `supabase/migrations/20260727000005_activation_without_typing.sql`.
- [x] 1.2 Unique partial index `account_invites_live_code` on `(code_hash) where consumed_at is null and superseded_at is null` (D2) — the lookup's index and its guarantee at once.
- [x] 1.3 Table `invite_redemption_attempts (id, ip_hash, attempted_at)` with an index on `attempted_at`; RLS enabled with no policy, `service_role` granted, `anon`/`authenticated` revoked (D4). Not outlet-scoped and not client-readable, so it takes a deny-by-default posture rather than an isolation case.
- [x] 1.4 `public.record_invite_failure(p_ip_hash text)` — prunes rows past the window, then inserts one. Failures only (D4).
- [x] 1.5 `public.invite_attempts_exceeded(p_ip_hash text)` — true when this address hash or the whole endpoint is over its bound in the window. 20 per address, 500 globally, 15 minutes (D4).
- [x] 1.6 `public.preview_account_invite(p_code_hash text, p_ip_hash text)` returning `(status, email)` with `ok` / `invalid` / `rate_limited`; consumes nothing and advances nothing (D9).
- [x] 1.7 `public.redeem_account_invite(p_code_hash text, p_ip_hash text)` returning `(status, user_id)`; drop the three-argument address-keyed form in the same migration (D1).
- [x] 1.8 `public.invite_failure_pressure()` returning the window's failure count, refusing any caller that is not a Super Admin (D10).
- [x] 1.9 Grants: the three new functions `service_role`-only except `invite_failure_pressure`, which `authenticated` may execute and which checks the role itself. `security definer` with `set search_path = ''` throughout, matching the existing invite functions.

## 2. The edge function

- [x] 2.1 `redeem-invite` takes an explicit `action` — `preview` or `redeem` — and no email in either (D9).
- [x] 2.2 Derive `ip_hash` from the first `x-forwarded-for` entry, SHA-256, never the address itself (D5).
- [x] 2.3 `preview` returns `{ email }` on `ok`, the uniform `invalid_code` otherwise; a failure is recorded.
- [x] 2.4 `redeem` keeps the password-length check ahead of everything, so a short password still costs nothing and records no failure.
- [x] 2.5 `rate_limited` is returned as 429 with its own code, distinct from `invalid_code` (D6).
- [x] 2.6 Update the comment block at the top: it currently describes an address-keyed endpoint with a five-attempt bound.

## 3. The activation screen

- [x] 3.1 `src/lib/activation-link.ts`: build `<origin><base>activate?code=…` from `import.meta.env.BASE_URL` (D7). Unit-tested for the sub-path and root cases.
- [x] 3.2 `data-access/auth.ts`: `previewInvite(code)`; `redeemInvite(code, password)` loses its email argument; `ActivationError` gains `rate_limited`.
- [x] 3.3 Rewrite `src/auth/activate.tsx` as the four states of D8 — checking, confirming, setting a password, and the dead-link state — reading `?code=` from the URL.
- [x] 3.4 With no code in the URL, ask for the code alone and run the same preview, so the screen serves a person who has only the code.
- [x] 3.5 "Yes, that's me" and "That's not my email" as two equally reachable buttons, never a passive Continue (D8).
- [x] 3.6 The "not my email" branch says to ask the manager, who can correct the address and issue a new code.
- [x] 3.7 On success, sign in with the address preview returned and the password just set — the one path a session is minted by (#4 D5).
- [x] 3.8 Component tests: a link activates with one field; a dead link fails before any field appears; denying the address offers no password field; a rate-limited attempt says so; a short password names the password.

## 4. The handover panel

- [x] 4.1 Add `qrcode-generator` (MIT, dependency-free) and a `QrCode` component rendering SVG (D11).
- [x] 4.2 Two fixed tokens `--qr-module` / `--qr-field` in `tokens.css`, identical in both themes, so the component reads tokens and carries no hex and the mark is never inverted (D11).
- [x] 4.3 `IssuedCodePanel`: the link first with Copy, the QR second, the code last with its own Copy (D12).
- [x] 4.4 Keep the address read-back #15 added — it is the check the confirmation screen depends on.
- [x] 4.5 Component tests: the panel shows a link carrying the code and no address, and renders the QR.

## 5. Failed activations, made visible

- [x] 5.1 `AccountsAdapter.failedActivations()` on the seam, returning the window's count or null when the caller may not ask (D10).
- [x] 5.2 Supabase adapter calls the RPC; mock returns a quiet number.
- [x] 5.3 A banner on People and Access above the threshold, for a Super Admin only.
- [x] 5.4 Drop `attempts` from `AccountSummary.invite` and from the surface: under code-keyed lookup it can only ever read zero, and a control that cannot move should not be displayed as one (D3).
- [x] 5.5 Component test: the banner appears above the threshold and not below it.

## 6. Sign-in copy

- [x] 6.1 The email field says it is the address they gave their manager (D13).

## 7. Database and REST tests

- [x] 7.1 `supabase/tests/10_activation.sql`: the live-code unique index refuses a duplicate; the rate limiter counts failures only and refuses past the bound; `invite_failure_pressure` refuses a Franchise Admin and answers a Super Admin; preview consumes nothing; redemption by code alone works and is single-use.
- [x] 7.2 `supabase/tests/rest/activation.test.ts`: provision → preview → redeem → sign in, entirely through the Edge Function with no email anywhere; a spent code previews as invalid; a rate-limited caller gets 429 with `rate_limited`.
- [x] 7.3 Both suites clean up after themselves and pass when run after each other, as #15's did.

## 8. End-to-end

- [x] 8.1 `e2e-auth/auth.spec.ts`: activation walks the link, not the two fields — provision, read the link off the panel, open it on another context, confirm the address, set a password, land signed in.
- [x] 8.2 The replay case still proves single use, now against the link.
- [x] 8.3 A demo-mode case: provisioning shows the link and the QR, and the walk makes no request off the app origin.

## 9. Docs and verification

- [x] 9.1 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` green.
- [x] 9.2 `npm run test:db` and `npm run test:rls` green against the local stack.
- [x] 9.3 `npm run test:e2e` against the production build.
- [x] 9.4 `npm run contrast` and the no-hex check green with the two new tokens.
- [x] 9.5 Inspect the activation screen and the handover panel on a phone and a tablet viewport, light and dark, with zero console errors and no unexpected network traffic.
- [x] 9.6 Verify the query string survives the SPA fallback in a real preview of the production build. (`vite preview` serves its own fallback, so this proves the router and the base path; the `404.html` half is proved by the existing "fallback matches the shell" case and confirmed on the deployment itself.)
- [x] 9.7 Docs in this change: `docs/SCREENS.md` (activation is one field), `docs/OPERATIONS.md` (the handover step and the "a code will not work" runbook), `docs/SECURITY_AND_PRIVACY.md` (the guessing bound is an endpoint limit; attempt records hold a hashed address).
- [x] 9.8 🧍 Send yourself the link from a real phone and activate from a WhatsApp tap.
