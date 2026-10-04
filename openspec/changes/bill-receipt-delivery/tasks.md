# Tasks: bill-receipt-delivery

- [x] 1. Reconcile landing messaging/terms/privacy and #59 gate with number-as-opt-in; verify landing build.
- [x] 2. Add disabled durable jobs, frozen points, async wakeup/recovery, service-only operations, RLS and explicit isolation tests.
- [x] 3. Implement MSG91 sending and authenticated reports; prove failure, uncertainty, concurrency and callback races without PII logs; typecheck handlers.
- [x] 4. Show safe delivery status through the typed billing adapter in manager Customer details; retain counter, shimmer shape, WhatsApp fallback and no-send demo.
- [x] 5. Update durable docs, regenerate types, format first and pass full lint/types/unit/contrast/build/E2E/database/RLS/auth gates; exercise offline/replay against the local backend.
- [ ] 6. Deploy matching pages, migration and handlers; configure server secrets and reports; activate future bills and verify one authorized real handset SMS and receipt/PDF.
- [ ] PHASE GATE: new valid-number bills send receipt/points automatically after settlement/sync, once per bill; no number, history and demo send nothing; failures are visible and billing never waits for SMS.
