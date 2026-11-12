# Tasks: retire-a-tablet-keeps-its-login

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half.

## 0. Preconditions

- [x] 0.1 The change is archived: `a-tablet-keeps-its-login`, on 12 November,
  the pull waived under the owner's rule of 30 October.
- [x] 0.2 The gate is on in production and has stayed on.
  *(`change_gate_events`: on at 07:15 IST on 1 November, nothing since; every
  registered device boots with it; read on 12 November.)*
- [x] 0.3 Nothing depends on it.
- [x] 0.4 The owner's "happy to retire it": 12 November, "go ahead" to retiring
  AM, TK and DO.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: `TabletBoundary` always fences
  a tablet to its home, and `signIn` and `redeemInvite` always refuse while the
  browser holds a tablet's session.
- [x] 1.2 The off path's code goes: the boundary's pass-through and
  `src/change-gates/a-tablet-keeps-its-login.ts`. The per-screen tablet
  redirects in `RealRoot`, `RootResolver`, `CounterRoot`, `KitchenRoot` and
  `CounterSetup` stay, against the declaration's plan: each is also the branch
  that narrows the session type before the screen reads a person's session, so
  removing it is a rewrite of five routing screens for no change in behaviour.
  The boundary answers first, so none of them is reached by a tablet.
- [x] 1.3 The key moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and out of
  the demo's gate words.
- [x] 1.4 Tests: the `describeChangeGate` block in `auth-tablet.test.ts` and the
  boundary's on block become plain tests; the off ones go, unit and the
  `@cg-off` browser test in `e2e-auth/tablet-keeps-its-login.spec.ts`, whose
  `@cg-on` tag drops. Four suites that mock `@/data-access/auth` now answer
  `storedSessionIsDeviceNow`, which the boundary asks of every real route.
- [x] 1.5 `docs/` (ARCHITECTURE, OPERATIONS, SCREENS, SECURITY_AND_PRIVACY) no
  longer calls the behaviour gated. No spec named the gate.
- [ ] 1.6 `npm run lint`, `format:check`, `typecheck`, `contrast`, `test`,
  `build`, `lint:change-gates`; the auth suite whole on Staging (routing).
- [ ] 1.7 Release: push to `stage`, Staging green, the owner promotes.

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract a-tablet-keeps-its-login`.
  Nothing in the database reads the key (re-run the reader query first), so it
  retires the row only.
- [ ] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
