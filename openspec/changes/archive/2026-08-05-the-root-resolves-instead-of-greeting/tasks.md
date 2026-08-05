## 1. The shared placeholder and the shared session

- [x] 1.1 Add the app-boot placeholder to `src/components/ui/loading.tsx` as a named composition beside `LoadingList`/`LoadingBlock`/`LoadingTable`/`LoadingFigures` (header strip plus content block, D4), and replace `RealRoot`'s inline `LoadingRegion` at `src/auth/real-root.tsx` with it. Same shape, one definition.
- [x] 1.2 Extract the "could not confirm" retry card from `real-root.tsx` into a shared component so the root and the role shells state the same fact in the same words (D3). Keep the existing sentence and the `revalidate` retry button verbatim.
- [x] 1.3 Add `RealSessionProvider` and its context, calling `useRealSession()` exactly once and publishing `{ state, revalidate, endSession }`. The provider renders its `Outlet` unconditionally and shows no placeholder of its own (D6).
- [x] 1.4 Mount the provider in `src/routes/index.tsx` as a **pathless** layout route wrapping the `/` and `/:roleSegment` branches, with `/demo` left as a sibling outside it (D5). Update that file's route-shape doc comment to describe the new nesting and why demo is outside.
- [x] 1.5 Change `RealRoot` to read `state`, `revalidate` and `endSession` from the context instead of calling the hook. `use-real-session.ts` itself is unchanged.

## 2. The root resolves instead of greeting

- [x] 2.1 Replace `src/routes/landing.tsx` with a resolver whose name says what it does (`RootResolver`), carrying no product copy and no navigation: `loading` renders the boot placeholder, `ready` navigates to the held role's home, `anonymous` navigates to `/sign-in`, `unavailable` renders the shared retry card (D1, D2, D3). Update the import in `src/routes/index.tsx`.
- [x] 2.2 Write the component's doc comment around the one rule that matters: only a confirmed `anonymous` reaches sign-in, because `getSession()` is a local read and every failure path resolves to `indeterminate` instead (D2).
- [x] 2.3 Centre the sign-in card the way `Unplaced` and the retry card already do, so the app's front door is composed as a screen rather than as content in a longer page (D9).

## 3. Activation stops asking for a code

- [x] 3.1 Delete the `need-code` state, `typedCode` and `onCodeSubmit` from `src/auth/activate.tsx`; reduce `State` to `checking | form | dead`. A mount with no `?code=` starts at `dead` with a message saying the link is **incomplete**, distinct from the existing dead/spent-link message, and offers the way to sign in (D8).
- [x] 3.2 Remove the `/activate` link from `src/auth/sign-in.tsx` and widen the remaining sentence to cover a first activation as well as a forgotten password: one line telling anybody without a working password to ask a Franchise Admin or Super Admin for a one-time link.

## 4. Tests

- [x] 4.1 Component tests for all four root states, including the one this change exists for: with a stored session and a failing profile read, the root shows the retry card and **never navigates to sign-in**.
- [x] 4.2 A test that pins D6: sign-in renders its form while session state is still `loading`, so a future edit that makes the provider gate rendering fails.
- [x] 4.3 A single-resolution test for the root-to-shell handoff: opening the root as a signed-in person reads profile and assignments **once** for the visit, not once for the root and again for the shell. If that proves awkward at the component level, assert the read count directly (D5, risks).
- [x] 4.4 Update `src/auth/auth-screens.test.tsx`: delete the `need-code` coverage, and add that `/activate` with no code presents no code field, says the link is incomplete, and offers sign-in.
- [x] 4.5 Update the E2E suites that reach the root through its card: `e2e/demo.spec.ts` (the exit assertion, the deep-link assertion, and the "landing page offers no route into the demo" test, which becomes the same assertion about the screen the root resolves to), `e2e/install-app.spec.ts` (it clicks the card's Sign in **link**, which is now a submit **button** on the sign-in screen), and `e2e/activation.spec.ts`.
- [x] 4.6 Confirm the demo seam is untouched rather than assuming it: `src/demo/demo-safety.test.tsx` still asserts the exit points at `/`, and no real session resolves under any `/demo` path (`isDemoScopeActive()` stays true throughout and no Supabase client is constructed).

## 5. Documentation

- [x] 5.1 `docs/SCREENS.md`: document the application root and its four states, which the page does not describe today; delete the sentence promising that "Someone handed only the code types it first and reaches the same form"; and update the Sign in paragraph's routes onward.
- [x] 5.2 `docs/DEMO_MODE.md`: replace both mentions of the public landing page (the "Where the link comes from" heading text and the undiscoverability note) with the screen that replaces it, leaving the behaviour they describe unchanged.
- [x] 5.3 `docs/TESTING.md`: record the root-state and single-resolution coverage. Reconcile the roadmap board with `npm run roadmap:sync` rather than hand-stamping; this is a fix, so it takes no ROADMAP.md row, number or wave.

## 6. Verification and phase gate

- [x] 6.1 Run the first CI job's gates: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`. Use `npm run format` if formatting needs repair, and record exact results.
- [x] 6.2 Run `npm run test:e2e`. Pay attention to `e2e/offline.spec.ts`, which primes the service worker at the root: with no stored session the root must resolve to sign-in offline, and the header banner plus build version must still be visible because `RootLayout` still wraps that screen.
- [x] 6.3 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`, because the sign-in and activation paths both change and the auth suite is what exercises them against a real stack.
- [x] 6.4 Inspect the real flows at phone and tablet viewports in both themes: cold launch at the root as signed-in and as signed-out, the boot placeholder handing off to the shell without a second placeholder, the retry card, the centred sign-in card, an activation link opened with and without a code, and the install action's continuity from the entry screen into a shell.
- [x] 6.5 PHASE GATE: a signed-in cold launch reaches its own shell with no marketing card and no second placeholder; a confirmed signed-out visitor reaches sign-in directly; a session that cannot be confirmed offers a retry and is never sent to sign-in; the session resolves once per visit; `/activate` has no code field and says so when the link is incomplete; and demo mode resolves no real session and still exits to the root.
