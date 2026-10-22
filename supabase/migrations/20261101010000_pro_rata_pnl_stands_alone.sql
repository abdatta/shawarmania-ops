-- retire-one-revenue: `pro-rata-pnl` stops depending on `one-revenue`.
--
-- Pro-rata P&L was built on One Revenue's figures, so it was declared to run
-- only with them. This retirement keeps those figures for good, and a retired
-- gate reads off: left in place, this edge would turn Pro-rata P&L off on every
-- screen the moment the contract migration retires `one-revenue`. It goes now,
-- with the code half, so the code and the database keep describing the same
-- gate.
--
-- Nothing else changes. No function, policy or trigger reads either gate, and
-- `one-revenue` stays on until its contract migration: a build that still
-- declares the dependency still finds its parent on. The only difference is
-- that turning `one-revenue` off on the Change gates page no longer turns
-- Pro-rata P&L off with it.

-- release-lint: allow data — removes the one dependency edge this retirement cuts; every published build still finds `one-revenue` on, so none reads a gate differently
delete from public.change_gate_dependencies
 where gate_key = 'pro-rata-pnl' and depends_on = 'one-revenue';
