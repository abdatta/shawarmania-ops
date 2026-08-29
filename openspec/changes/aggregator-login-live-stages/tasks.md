## 1. Schema — the stage lives on the request already under way

- [ ] 1.1 Migration on `aggregator_auth_requests`: add `stage text` (check-constrained to the closed seven-word vocabulary) and `stage_at timestamptz`, both nullable, with column comments saying a null stage is a request from before this change and renders as today's card.
- [ ] 1.2 Confirm the existing owner-only policy is unchanged and covers both columns. **Do not widen the policy to make the stepper easier** — the `code` column's unreadability is the property this change must not weaken.
- [ ] 1.3 Re-assert the isolation test case for `aggregator_auth_requests` against the new columns: a Franchise Admin at one outlet reads neither for another outlet's request.
- [ ] 1.4 Confirm the existing expiry sweep is unaffected by a request carrying a stage.
- [ ] 1.5 Regenerate `database.types.ts`.
- [ ] 1.6 Sectional check: `npm run test:db` and `npm run test:rls` green.

## 2. The reporting boundary

- [ ] 2.1 Add `report_stage` to `aggregator-reader`: runner-authenticated, validates `stage` against the closed vocabulary, stamps `stage` and `stage_at` on the open request for the channel.
- [ ] 2.2 Refuse an unrecognised stage loudly rather than storing it, matching how `outcome` is handled. No free text crosses the boundary.
- [ ] 2.3 Refuse a stage for a channel with no open request, and for a request already closed.
- [ ] 2.4 Sectional check: edge-function tests cover a valid stage, an unknown word refused, a closed request refused, and a non-runner caller refused.

## 3. Sync repo — narrate what it already passes through

- [ ] 3.1 Report stages from `auth.mjs` in `abdatta/shawarmania-sync` via the shared helper, at the milestones the flow already reaches: browser up, portal reached, identifier entered, code screen rendered, code accepted, signing in, Hyperpure captured.
- [ ] 3.2 Reporting is best-effort — a failed `report_stage` call must never fail a working sign-in.
- [ ] 3.3 Confirm no token, cookie value or code reaches a log line, workflow summary or committed file through the new calls.
- [ ] 3.4 Sectional check: dispatch the login workflow on a branch ref and read the request row's stage advancing through the sequence.

## 4. Following stages live

- [ ] 4.1 Subscribe to `postgres_changes` on the open request row while a dispatched reconnect has one; unsubscribe when it closes.
- [ ] 4.2 **Assert the security property**: a subscribed client receives `stage` and never `code` or session material. This is a test, not a review note.
- [ ] 4.3 Degrade to today's behaviour when realtime never connects or drops: the existing five-second health poll still closes the loop, and no stage is shown that cannot be confirmed.
- [ ] 4.4 Sectional check: realtime test suite green (`vitest.realtime.config.ts`).

## 5. The stepper

- [ ] 5.1 Render the seven stages in owner words, past ticked, current live. Settle inline-on-the-Hyperpure-line versus a card between the health lines, and record the choice in `design.md`.
- [ ] 5.2 Move the code field and its countdown inside stage four; remove the disconnected code card.
- [ ] 5.3 Collapse the stepper into the existing quiet/ended line per outcome when the request closes. That line is unchanged.
- [ ] 5.4 Implement the staleness rule: after the bounded silence, stop claiming the stage, say the sign-in has gone quiet, offer the owner an action. Settle the bound — it must exceed the slowest legitimate stage, which is the one waiting on a human — and record it.
- [ ] 5.5 Settle whether a stage may go backwards (a retried identifier, a second code) and whether the stepper reruns or holds. A tick that unticks silently is not acceptable.
- [ ] 5.6 A reconnect that needs no login shows no stepper at any point.

## 6. Demo mode

- [ ] 6.1 Walk all seven stages against mocks, like every other state this surface shows.
- [ ] 6.2 Include the stall: a mocked sign-in that stops reporting and reaches the quiet state.
- [ ] 6.3 Include the still-alive reconnect that shows no stepper.
- [ ] 6.4 Confirm a demo session still cannot write to Supabase.

## 7. Docs

- [ ] 7.1 `docs/SCREENS.md`: the stepper, replacing the description of the disconnected code card.
- [ ] 7.2 `docs/OPERATIONS.md`: what the owner sees during a sign-in, and what a stalled sign-in looks like.
- [ ] 7.3 Merge the spec delta into `openspec/specs/aggregator-channel-sessions/spec.md`.

## 8. PHASE GATE

- [ ] 8.1 **Gate (#46):** the owner taps Reconnect, the full-login rung fires, and the screen shows where the sign-in actually is — starting, opening the partner portal, signing in as you, waiting for your code (with the input field appearing at that stage), checking your code, bringing Hyperpure along, done — each arriving within seconds of the runner reaching it and without a refresh; a runner that dies mid-stage stops claiming progress; no auth-request content beyond the stage ever reaches a client; and the four-role demo walkthrough still walks.
- [ ] 8.2 Suite gates: lint, typecheck, format:check, unit, build, e2e, contrast, `test:db`, `test:rls` — all green, per the CI workflow file rather than a docs checklist.
- [ ] 8.3 Report the gate honestly. A live full-login rehearsal spends a real owner code and destroys a working session; if the gate is claimed against a branch-ref dispatch rather than a natural lapse, say so.
