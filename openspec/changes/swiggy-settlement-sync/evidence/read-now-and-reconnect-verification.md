# Read now and missing-session reconnect verification (2026-08-25)

The owner Swiggy Read now request is now a production dispatch to
`swiggy-daily.yml`: the request carries its `outlet_id`, `rehearse=false` and
`write=true`. The sync workflow filters `SWIGGY_MAPPINGS` to every enabled
mapping for that outlet, rejects an absent mapping and shares the existing
`aggregator-swiggy-session` concurrency group.

The owner surface now reads the secret-free `has_session` health field. A
configured Swiggy outlet whose saved session was deleted offers Reconnect even
before a reader writes a `session_lapsed` event. The reconnect contract selects
only `login.yml(channel=swiggy)`; it cannot run the Zomato or Hyperpure repair.

## Passing checks

Ops:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test` — 120 files, 1,398 tests passed.
- `npm run contrast` — 52 light/dark AA pairs passed.
- `npm run build`
- `npm run test:e2e` — 248 browser tests passed across tablet and desktop.

The focused dispatch/recovery suite also passed: 4 files, 59 tests.

Docker-backed Ops checks:

- `npm run db:start && npm run db:reset`
- `npm run test:db` — 43 files, 1,912 pgTAP tests passed.
- `npm run test:rls` — 9 realtime, 191 RLS and 4 billing-race tests passed.
- `npm run test:e2e:auth` — 21 real-backend auth/offline browser tests passed.
- `npm run db:types` followed by
  `git diff --exit-code src/data-access/database.types.ts` — clean.

Sync repository:

- `npm run test:swiggy` — 32 tests passed, including the outlet-scoped
  write-dispatch workflow contract.
- `python -c "import yaml; yaml.safe_load(open('.github/workflows/swiggy-daily.yml', encoding='utf-8'))"`
  — YAML syntax valid.

No live reader, OTP, session deletion or GitHub workflow dispatch was run.
