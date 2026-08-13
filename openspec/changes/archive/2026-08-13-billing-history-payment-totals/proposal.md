# Proposal: billing-history-payment-totals

> **Kind**: product usability correction, not a sequenced roadmap change · **Gate**: a manager can open payment totals from Billing history and read the selected outlet day's settled Cash and UPI totals in large cards; the counter's personal shift rail no longer duplicates those aggregates.

Move Cash and UPI aggregate visibility from the shared counter tablet's Bills this shift rail and manager Tablets card to a deliberately opened Totals view in manager Billing history. Totals cover settled bills at the selected outlet and business date, independent of the detail-list filters, so they remain a stable day-level read. Cancellation relies on its durable inline banner rather than a duplicate persistent success message. This changes presentation and reads only: no billing write, money arithmetic, adapter contract, gate, offline, or tenancy change.
