## REMOVED Requirements

### Requirement: Profit is reported on one of two named bases, and the basis is always stated

**Reason**: Estimated profit had no live reader, and `#13 owner-console-live` —
the roadmap change that would have given it one — is withdrawn in this change
(owner decision, 2026-08-31).

`#12 retire-the-manual-ledger` had already narrowed this requirement to a single
cash basis when it withdrew the consumption basis for want of inventory
movements, and named the surviving basis a ceiling while aggregator commission
is undetermined. That left one basis with no screen to state it on. This change
removes the last of it.

The owner reads what the business earned in the Ledger, from recorded rows, with
no estimate involved.

### Requirement: Profit arithmetic is integer paise and rejects anything else

**Reason**: Withdrawn with the capability above. **Integer paise remains
non-negotiable everywhere else** — it is a project constraint stated in
`openspec/config.yaml` and enforced by every money-handling capability that
survives; nothing about removing this estimate relaxes it.

*(This capability also carried "Raw materials are counted once, never twice",
which `#12` removed on 2026-09-01 along with the consumption basis it guarded.
It is named here only so a reader comparing against an older copy of the spec
does not go looking for it.)*
