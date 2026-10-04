# Tasks: bill-receipt-delivery

- [x] 1. Reconcile landing messaging/terms/privacy and #59 gate with number-as-opt-in; verify landing build.
- [x] 2. Add disabled durable jobs, frozen points, async wakeup/recovery, service-only operations, RLS and explicit isolation tests.
- [x] 3. Implement MSG91 sending and authenticated reports; prove failure, uncertainty, concurrency and callback races without PII logs; typecheck handlers.
- [x] 4. Show safe delivery status through the typed billing adapter in manager Customer details; retain counter, shimmer shape, WhatsApp fallback and no-send demo.
- [x] 5. Update durable docs, regenerate types, format first and pass full lint/types/unit/contrast/build/E2E/database/RLS/auth gates; exercise offline/replay against the local backend.
- [x] 6. Deploy matching pages, migration and handlers; configure server secrets and reports; activate future bills and verify one authorized real handset SMS and receipt/PDF.
- [x] 7. **Ask for the number at payment** [owner, 3 October 2026; implementation authorized
      4 October; keep it local for owner UI review before finalizing].
      The payment dialog's first step asks for the customer's number when none is attached,
      worded around the receipt ("for your bill and points on your phone"), then shows gold and
      points, then the total, then the tender: gold and points change the total, so the number
      must come before the tender, not after. A number attached at ordering is shown and kept;
      the order-time row stays. Skipping stays one tap. This changes the settle path's input
      (customer attached at pay time) and therefore the counter, the outbox payload and the
      demo seam: run the full gate set, offline replay included, and keep the existing
      order-time flow working. `/messages/` already says the counter asks "when you pay".
- [ ] 8. **Confirm points actually earn before customers read "You earned 0 points".** Kalyani
      Cafe has points on (5 per ₹200, 10% cap) but bill 199 (3 October, ₹270, the first bill
      with a customer; its order had the customer at ordering) has no `earned` row, where the
      rule gives 6. The likely cause is the switch going on after that bill (earning reads it
      when the bill arrives; `outlets` keeps no change time), but it is unproven. Check the
      first customer bill after activation: if it also earns nothing, `bills_points_on_settle`
      is the suspect and every receipt SMS is sending zeros. Read-only check against production:
      `select b.bill_number, b.paid_at, e.points from bills b join outlets o on o.id = b.outlet_id
      left join customer_points_entries e on e.bill_id = b.id and e.kind = 'earned' where o.name =
      'Kalyani Cafe' and b.customer_id is not null order by b.paid_at desc;`
- [x] 9. **Owner reviews the expanded checkout UI** before commit/finalization, push or deployment.
      Owner approved the reviewed checkout and collection switch on 4 October
      2026 and explicitly authorized pushing. Release may proceed; task 8 stays open.
- [x] 10. **Outlet-level customer collection choice** [owner, 4 October 2026].
      Add a default-on Collect customer details switch for owner and same-outlet
      franchise admins. Off hides composer/edit customer entry, permits anonymous
      orders and skips checkout prompts. Preserve existing customer facts and
      benefits, carry the choice offline, reshape settings shimmer, regenerate
      types and prove role isolation plus the complete local verification suite.
- [x] PHASE GATE: new valid-number bills send receipt/points automatically after settlement/sync, once per bill; no number, history and demo send nothing; failures are visible and billing never waits for SMS. Automatic settlement/replay proved against the real local backend; production sending enabled and the authorized provider/receipt/report check passed. No synthetic production sale was added.
