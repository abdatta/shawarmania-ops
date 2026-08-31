## REMOVED Requirements

### Requirement: Profit is reported on one of two named bases, and the basis is always stated

**Reason**: Estimated profit had no live reader, and `#13 owner-console-live` —
the roadmap change that would have given it one — is withdrawn in this change
(owner decision, 2026-08-31). The consumption basis also depended on the stock
actually used, which is unavailable now that inventory is removed rather than
merely shelved.

The owner reads what the business earned in the Ledger, from recorded rows, with
no estimate involved.

### Requirement: Raw materials are counted once, never twice

**Reason**: Withdrawn with the capability above. The double-count it guarded
against cannot occur, because there is no longer a surface that subtracts both
spend and consumption.

### Requirement: Profit arithmetic is integer paise and rejects anything else

**Reason**: Withdrawn with the capability above. **Integer paise remains
non-negotiable everywhere else** — it is a project constraint stated in
`openspec/config.yaml` and enforced by every money-handling capability that
survives; nothing about removing this estimate relaxes it.
