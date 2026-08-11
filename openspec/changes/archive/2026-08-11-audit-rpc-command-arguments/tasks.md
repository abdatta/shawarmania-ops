## 1. Inventory the command boundary

- [x] 1.1 Enumerate every browser-adapter and Edge Function `.rpc(...)` call from a repository-wide search, record the reconciled call-site count, and separate reads from writes without excluding either from argument-shape review.
- [x] 1.2 For every call, compare its arguments with the final function signature exposed by the reset local database and classify each parameter as required, required-nullable, or optional-by-default.
- [x] 1.3 Inspect the JSON-serialized payload for every value derived from optional input, an optional chain, a conditional, or a cast; confirm required keys survive and every omitted key has a database default.
- [x] 1.4 Record the audit result explicitly, including the names of any unsafe callers found or the evidence that the two fixed attendance callers were the only live instances.

## 2. Correct and pin unsafe paths

- [x] 2.1 For each unsafe caller found, send the required unknown fact explicitly as `null` without adding a database default or changing command authority and behavior.
- [x] 2.2 Add or strengthen adapter payload assertions so each required-nullable empty/unknown variant is present after `JSON.stringify` round-tripping.
- [x] 2.3 Add or strengthen real-transport cases against the reset local stack, asserting the intended successful row/result rather than accepting any rejection as proof.
- [x] 2.4 If no new unsafe caller exists, leave safe production code untouched and add only coverage or documentation that closes a demonstrated verification gap.
- [x] 2.5 For every defect corrected, prove the targeted test fails with the unsafe payload restored and passes with the correction applied.

## 3. Make the rule durable

- [x] 3.1 Update `docs/ARCHITECTURE.md` with the audited browser and privileged-call boundaries while preserving the rule that omitted and null are different facts.
- [x] 3.2 Update `docs/TESTING.md` so every new command family owes post-serialization coverage and a successful real-transport empty/unknown case where applicable.
- [x] 3.3 Remove `undefined-command-arguments-vanish-on-the-wire.md` from the active backlog and move its index entry to Graduated / Absorbed with this change as the resolution.

## 4. Verification

- [x] 4.1 Run the targeted adapter tests and each affected REST test against the reset local Supabase stack.
- [x] 4.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [x] 4.3 Run `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth` when a real-transport fixture or shared command path changed; record any deliberately unrun database gate with its reason if the audit is evidence-only.
- [x] 4.4 Confirm no migration, policy, gate, demo-seam, or roadmap row was added and `npm run roadmap:sync` leaves `ROADMAP.md` unchanged.

## 5. PHASE GATE

- [x] 5.1 **Non-roadmap gate**: every current browser and Edge Function RPC call is reconciled with its final database signature; required unknown facts survive JSON serialization as explicit nulls; omissions exist only for declared defaults; required-nullable paths succeed over the real transport; and any unsafe caller found is corrected and pinned.
