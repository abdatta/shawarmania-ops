# Proposal: manager-bill-cancellation-dialog

> **Kind**: product usability correction, not a sequenced roadmap change · **Gate**: a manager opens bill cancellation in a focused dialog, records a required reason, and can scan a single payment or split tender in one compact, structured line without implying that every cancellation requires a replacement sale.

Move the existing manager bill-cancellation confirmation into a dialog and remove the misleading correction/manual-re-ring wording while retaining the required reason. Simplify the immutable bill's payment card to one horizontal payment summary: one tender and amount for ordinary bills, or a concise Cash/UPI allocation for splits. This changes presentation and focused coverage only; it does not change billing writes, void reasons, money arithmetic, adapters, gates, offline handling, or access control.
