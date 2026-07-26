# Behavior Backlog

This directory tracks bugs, investigations, and feature ideas **before** they are promoted into formal OpenSpec changes. Nothing here is sequenced, gated, or committed to.

Keep entries behavior-focused:

- Describe the user-visible expectation, the observed behaviour, and the constraint that makes it non-trivial.
- Avoid naming implementation files, functions, or database internals unless they are part of the behaviour contract.
- Never include real customer names, phone numbers, employee data, or production figures. Use synthetic examples.
- When an item is ready to build, graduate it into `openspec/changes/<change-id>/` via `/opsx:propose` and add it to the inventory table in [`../changes/ROADMAP.md`](../changes/ROADMAP.md).

## Items

| Item | Type | Status | Area | Trigger to promote |
| --- | --- | --- | --- | --- |
| [Bill Thermal Printing](./bill-thermal-printing.md) | Feature | Anticipated | Billing | A customer or regulator asks for a printed bill |
| [Bill GST Breakup](./bill-gst-breakup.md) | Feature | Anticipated | Billing | The business registers for GST or a customer requires a tax invoice |
| [Bill Digital Share](./bill-digital-share.md) | Feature | Anticipated | Billing | The owner wants digital receipts, or paper is being skipped anyway |

The three billing items are grouped deliberately: v1 ships bills as **record-only**, and all three extensions were anticipated in the schema so none of them requires migrating historical bills. See [Limitations](../../docs/LIMITATIONS.md#bills-are-record-only) for exactly which columns exist ahead of need, and why.

## Graduated / Absorbed

| Former item | Where it went |
| --- | --- |
| _(none yet)_ | |
