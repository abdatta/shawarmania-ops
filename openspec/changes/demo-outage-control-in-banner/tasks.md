## 1. The mock backend can be taken away

- [x] 1.1 Give `DemoStore` a connectivity slice: a boolean the demo owns, a setter, and a listener set. On the store rather than on any host, so it survives a role switch (adapters are rebuilt per role, the data is not) and is rebuilt by reset for free. Document in the slice's own comment which adapter owns its writes, as every other slice does.
- [x] 1.2 Make the mock billing adapter's `isOnline()` read the store's flag **and** `navigator.onLine` — offline if either says so — so a genuine devtools toggle keeps behaving exactly as it does today.
- [x] 1.3 Subscribe `watchConnectivity(on)` to the store's connectivity alongside the two `window` events, routing a change through the existing `onOnline`/`onOffline` handlers. No new drain or settle path: reconnection must be the path the browser's own `online` event already takes, or exactly-once stops being the guarantee the suite proves.
- [x] 1.4 Unit coverage on the mock: work rung while the store is offline stays undelivered and is reported by the sync snapshot; returning online delivers it exactly once with no duplicate bill; `serverReachable` follows the flag; the browser event path still works with the flag untouched.

## 2. The context, mirroring the reset

- [x] 2.1 Add `src/demo/demo-connectivity.ts`: a context carrying the current state and a setter, `null` outside the demo counter's tree, with a `useDemoConnectivity()` reader. Mirror `demo-reset.ts` including its stated reason — the banner is an opaque slot the shells must not learn anything about.
- [x] 2.2 Name the three states as one union in that module (`online`, `network-dropped`, `closed-and-reopened`), so the banner and the counter host cannot disagree about what exists.

## 3. The strip is deleted and the counter provides the context

- [x] 3.1 Delete the `Extended-outage walkthrough` strip from `src/demo/demo-counter.tsx`. The tablet returns to sitting directly beneath the banner.
- [x] 3.2 Provide `DemoConnectivityContext` from `DemoCounter`, wrapping the tree that already renders `{banner}` — context resolves by tree position, which is what lets a banner constructed in `DemoRoot` read it. Keep the `CounterResumeRecord` construction here, unchanged in shape and schema version, next to the session it belongs to.
- [x] 3.3 Wire the three transitions in one place: `closed-and-reopened` sets both the store flag and `offlineResume`; `network-dropped` sets the store flag alone; `online` clears both and re-reads. Record in a comment why the two pieces of state are separate rather than one.

## 4. The control joins the banner

- [x] 4.1 Add the connectivity picker to `src/demo/demo-banner.tsx`, rendered as `{connectivity && …}` and never from a role test, in the right-hand cluster with Start again and Exit demo.
- [x] 4.2 Build it with the role switcher's construction: a drawn pill with a colourless native `<select>` over it, real control at 16px so iOS does not zoom, options taking their colour back. Colourless rather than `opacity-0`, for the accessibility-tree reason that comment already gives.
- [x] 4.3 Full label at `sm` and above; icon-only below it with the label as `aria-label`, the icon naming the current state. Verify at 375px that the strip is one row and nothing wraps.
- [x] 4.4 Extend `src/demo/demo-safety.test.tsx`'s sweep — which presses every control in the strip and asserts the strip survives — to cover the new control in all three states, and add the two absence cases: a phone role's indicator, and a Biller URL resolving to `NotFound`.
- [x] 4.5 Prove reset restores online in `src/demo/demo-reset.test.tsx`, and that a role switch mid-outage does not reconnect the counter.

## 5. Browser coverage

- [x] 5.1 Rewrite `e2e/counter.spec.ts:630` and `:651` from button clicks to driving the select. Keep what they were proving — the resumed counter and the drain on reconnect — rather than weakening the assertions to fit the new control.
- [x] 5.2 Add the scene the demo could not previously reach: choose the dropped network, ring a bill, see it held and the sync indicator report it, return to online, see it deliver exactly once and the totals agree.
- [x] 5.3 Assert the banner is one row on a 375px viewport with the control present, and that no second strip renders on the Biller surface.

## 6. Documentation and verification

- [x] 6.1 Update `docs/DEMO_MODE.md`: the Biller section of the walkthrough gains both offline scenes as followable steps, and says where connectivity now lives. Update `docs/SCREENS.md` for the indicator's contents.
- [x] 6.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`; fix and repeat until green.
- [x] 6.3 **GATE** — verify every clause of the proposal's gate literally, naming the test or action that proved each: one row at 375px and on a tablet; no second strip; the tablet directly beneath the indicator; the dropped-network scene taking money and escalating; the drain being exactly once; the resumed state reached from a byte-identical record; absence on all three phone roles and on the Biller's not-found route; the indicator still undismissable after every control is pressed; and the four-role walkthrough still walking.
