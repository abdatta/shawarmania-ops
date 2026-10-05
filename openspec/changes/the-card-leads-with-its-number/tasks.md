# Tasks: the-card-leads-with-its-number

- [x] 1. Reproduce: a dine-in order with a table renders `Table 8` alone (`billing-counter.test.tsx` asserted exactly that), and every card prints the customer's name and the age.
- [x] 2. Pipeline card: reference `#N` then one place tag (table or order type) in one style, no customer line, no age, customer control right of the total with its details dialog and the gold star as its badge. Owner chose option C of three (outline tag, tinted pill, icon + caps).
- [x] 3. Wire `onSetOrderCustomer` from the counter through the rail: the ordinary edit, with the customer dialog opened.
- [x] 4. Docked card reference reads `#N · Table T`.
- [x] 5. Pin: `pipeline-card-number.test.tsx` (number then table tag, one style for table and Takeaway, star on the customer button, while the number is pending, no name or age, details dialog, add-customer hand-off, no control where nothing can be done); update the counter tests that asserted the old layout.
- [x] 6. Spec deltas for counter-billing and order-lifecycle.
- [x] 7. Screenshots of the rail and the customer dialog in light and dark on a tablet viewport.
- [ ] 8. GATE: CI green on the pushed branch; the owner confirms the layout and picks the deploy.
