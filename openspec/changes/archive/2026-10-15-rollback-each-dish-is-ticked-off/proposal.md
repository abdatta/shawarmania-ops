# Restore the counter and kitchen before #74

Customers are impacted by #74 and its follow-up repairs. Restore the counter,
kitchen, demo, domain and adapters to `014f5693`, preserving sales, receipts,
released migrations and historical dish/Ready facts. A forward corrective
migration restores the earlier RPC behavior. Keep the additive command envelope
and optional-field validation so a tablet can deliver work already queued by #74
without changing its identity or hash. No order is automatically completed.

The owner explicitly authorized an emergency production rollback and bypassing
CI on 2026-10-12. The emergency workflow still builds and typechecks the exact
rollback commit; the normal verification suite is subsequently run separately.
Do not reset production, erase browser storage or remove audit history.
