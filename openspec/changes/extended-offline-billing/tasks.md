## 1. Persisted Offline Generation

- [ ] 1.1 Extend Dexie with versioned atomic generations for device/outlet identity, grant bounds, server-observed time, cutover, menu, open-order projections, exact-phone cache entries, and provenance.
- [ ] 1.2 Hydrate a new generation only from successful authorized online reads and activate it atomically after every required component commits.
- [ ] 1.3 Add compatibility readers and migration tests that preserve pending commands and fall back safely when a generation is incomplete or unsupported.
- [ ] 1.4 Define and enforce retention for cached customer exact matches and other persisted projections without logging PII or payloads.

## 2. Offline Bootstrap And Domain Projection

- [ ] 2.1 Implement offline bootstrap checks for same installation/device, complete compatible generation, cached verified grant, and explicit pre-cutoff bounds.
- [ ] 2.2 Build a pure reducer that reconstructs device-owned open orders from authoritative projections plus immutable local command chains using integer-paise and optimistic-version rules.
- [ ] 2.3 Allow direct pay and create/revise/cancel/pay order actions after offline restart while retaining provisional references and never allocating official bill numbers locally.
- [ ] 2.4 Reuse only exact normalized customer results previously resolved on that device, label them cached, and leave unknown phones unresolved until sync.
- [ ] 2.5 Stop new commands at cutoff and expose pending/recovery status until online credentials create a fresh grant and generation.

## 3. Reconnect And User Experience

- [ ] 3.1 Show persistent offline, last-sync, cached-source, clock-skew, and revocation-unknown states on every reconstructed billing surface in both themes.
- [ ] 3.2 On reconnect, verify device/grant status before ordinary drain, preserve all envelopes, deliver dependency chains, quarantine explicit conflicts, and refresh authoritative projections afterwards.
- [ ] 3.3 Freeze ordinary billing and delivery when reconnect reveals revocation while retaining upload-only recovery for eligible pre-revocation work.
- [ ] 3.4 Require online verification, complete drain/resolution, ended grant, and server device-day seal before extended-offline work can stop blocking date sign-off.
- [ ] 3.5 Carry the `app-shell` correction from `openspec/todos/pipeline-rename-left-two-sentences-behind.md` into this change's delta, if it is still uncorrected when this change runs: the Counter workspace is the composer/Bills this shift middle column beside the **outlet's** preparation pipeline, not this tablet's open orders. Verify against the rail itself rather than against the paragraph; then close the todo, or narrow it to the `counter-billing` half that #35 owns.
- [ ] 3.6 Update `docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/LIMITATIONS.md` with the V2 offline boundary.

## 4. Verification And Phase Gate

- [ ] 4.1 Add unit tests for atomic generations, compatibility failure, cutoff calculation, local order reduction, cached exact-phone isolation, and PII-free retention.
- [ ] 4.2 Add browser tests for offline reload, extended capture, app close/reopen, cutoff, clock skew, app update, lost response replay, reconnect conflict, and learned revocation.
- [ ] 4.3 Run the billing offline path with twenty mixed direct/order commands through restart and reconnect, proving exactly-once server effects and explicit quarantine where forced.
- [ ] 4.4 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`, then inspect tablet light and dark layouts.
- [ ] 4.5 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth` against the local backend.
- [ ] 4.6 PHASE GATE — Billing V2.1 extended offline: after one online daily sign-in, the single enrolled device reloads offline, accepts twenty commands through an extended outage, stops at cutoff, blocks day sign-off while unreconciled, reconnects to exactly-once results and a valid device-day seal, and never opens a new business day without online reauthentication.
