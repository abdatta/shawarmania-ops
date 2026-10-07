# Tasks: served-spec-reruns-under-load

- [x] 1. Reproduce: a fresh reset, `test:db`, `test:rls` and the full `test:e2e:auth` passed (34 of 34) at 01:34 IST, and the drain took 2.4 s, because the `online` hint had reset every inherited backoff (`waitMs` about −300 ms in an IndexedDB dump after reload).
- [x] 2. Prove the mechanism: with the app taken away before reconnect, so no hint lands, the drain took 28.6 s and then 58.3 s against a 60 s budget, with one `create_order` holding 56 s of inherited backoff. With jitter at its top and a failed attempt just before reconnect it took 58.3 s in three of three runs.
- [x] 3. Fail it on demand: the same harness with every RPC 1.5 s slower failed at the 60 s budget, `Received: "stalled"`. The rerun without a reset failed with the reported strict-mode violation on `Prepared`, against order #45: a paid, unprepared member takeaway.
- [x] 4. `DRAIN_MS = MAX_BILLING_RETRY_MS + 30_000`; `unsentCardsAt` for the member's takeaway; `payCard` and `serveCard` take a locator.
- [x] 5. Under the same harness, with #45 still on the rail: passed, drained in 62.9 s.
- [x] 6. Harness removed. `npm run typecheck`, Prettier and ESLint on the spec, and the whole file run normally with #45 still present.
- [x] 7. GATE: CI's `gate / database + auth tests` green on the commit. The owner picks the push; this commit is local until then. *(Pushed with the 2026-10-04 release as `d1b942bc`. `gate / database + auth tests` has passed in every Deploy since, through run 37453264196 at `f319b8ad` on 2026-10-06.)*
