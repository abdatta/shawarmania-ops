# Emergency rollback evidence

The owner authorized production rollback and CI bypass on 2026-10-12, then
authorized dropping unfinished orders created after #74. Existing payments and
immutable sales remain preserved. The helper derives the identified owner's
current authority through the assignment functions before cancelling any order.

The corrective migration restored ten pre-#74 function definitions verbatim from
`014f5693`. Its rehearsal ran in a transaction ending in ROLLBACK. The production
application ran atomically at 12:05:33 UTC and registered migration
`20261017000000` in the same transaction. Neither operation changed financial
rows: 2,967 bills, total 85,874,600 paise, identical ordered bill fingerprint
`abe9bbfdffebab41482cef8cc21cbee5`. Billing envelope/line validators and additive
RPCs remain compatible with already queued #74 work; original receipt identities
and hashes survive. All released migration files remain intact.

The owner-authorized cancellation transaction used manager_cancel_billing_order
with current owner assignment checks. Zero open post-release orders remained,
and the financial fingerprint stayed identical. Paid orders and bills were not
deleted, voided or automatically marked prepared.

TypeScript passed after restoring pre-#74 source and retaining null label/note
fields in schema-typed demo fixtures. Full CI was deliberately bypassed for the
emergency release, not reported as having passed. Production publication and
postflight checks are recorded after the workflow completes.
