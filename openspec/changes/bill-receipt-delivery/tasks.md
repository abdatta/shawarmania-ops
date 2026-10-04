# Tasks: bill-receipt-delivery

- [x] 1. Reconcile landing messaging/terms/privacy and #59 gate with number-as-opt-in; verify landing build.
- [x] 2. Add disabled durable jobs, frozen points, async wakeup/recovery, service-only operations, RLS and explicit isolation tests.
- [x] 3. Implement MSG91 sending and authenticated reports; prove failure, uncertainty, concurrency and callback races without PII logs; typecheck handlers.
- [x] 4. Show safe delivery status through the typed billing adapter in manager Customer details; retain counter, shimmer shape, WhatsApp fallback and no-send demo.
- [x] 5. Update durable docs, regenerate types, format first and pass full lint/types/unit/contrast/build/E2E/database/RLS/auth gates; exercise offline/replay against the local backend.
- [x] 6. Deploy matching pages, migration and handlers; configure server secrets and reports; activate future bills and verify one authorized real handset SMS and receipt/PDF.
- [ ] 7. **Ask for the number at payment** [owner, 3 October 2026; confirm the shape with the
      owner before building, since the 3 October scope note left the counter layout alone].
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
- [x] PHASE GATE: new valid-number bills send receipt/points automatically after settlement/sync, once per bill; no number, history and demo send nothing; failures are visible and billing never waits for SMS. Automatic settlement/replay proved against the real local backend; production sending enabled and the authorized provider/receipt/report check passed. No synthetic production sale was added.
