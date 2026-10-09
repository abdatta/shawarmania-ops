# Proposal: an-edit-keeps-its-captured-lines

> **Model**: Opus · **Kind**: fix to shipped billing behaviour, not a roadmap change · **Gate**: a saved order edited at the counter sends every line it already held under that line's stored identity and captured price, and mints an identity only for a line the biller adds, whether the order was read from the server, is still queued on the tablet, or was paid and taken back; the demo counter keeps the same identities, never gives two lines of one order the same one, and a queued order read back before it is delivered already carries the identities it will be stored under; the database accepts a revision of a captured line after the menu price moved (already proved by `26_billing_transaction_contract.sql`); and `docs/LIMITATIONS.md` describes only the price-change refusal that remains.

## Why

`revise_billing_order` checks a line it already stores by identity and keeps its
captured price, but checks a **new** line against the menu as it stands and
refuses a mismatch as terminal `arithmetic_invalid` (design D8 of
`each-outlet-chooses-how-it-serves`). The live counter used to mint a fresh line
identity on every save, so every line of every revision was new, and editing an
open order after a price change was refused.

**The live half was already fixed, in passing, by #59** (`45c2b6fa`,
`bill-receipt-delivery`). `BillLineDraft.orderLineId` is read back from
`order_items.id`, `lineSnapshots()` reuses it and mints only where it is absent,
and a queued order is drawn from its own command's line identities, so a create
and a revision queued behind it agree. Nothing pins that at the counter screen,
though, and three things were left behind:

- **No counter-level test.** The adapter test proves identities survive the
  adapter; nothing proves the composer keeps them when an order is opened for
  edit, a quantity changes and a line is added. A refactor that rebuilds the
  lines would bring the refusal back with every suite green.
- **The demo adapter does not keep identities the way the live one does.** It
  mints `${orderId}-${index}` when a command is applied, so removing a line and
  adding another gives the new one an identity a kept line already holds, and an
  order still in its queue reads back with no identities at all.
- **The live adapter decided whether a line was an order line from the columns
  that came back.** `lineView()` attached the identity only when the row had an
  `order_id`. `order_items(*)` selects it today, but a read narrowed to save
  egress would drop every identity with no type error, and the refusal would
  return. The new adapter test found it: its fixture row, like such a read,
  carried no `order_id`.
- **A bill shown before delivery carried its order's line identities**, which a
  bill read from the server never does, so the same bill read two ways.
- **`docs/LIMITATIONS.md` still says the counter re-identifies every line**, and
  so overstates the limitation.

## What Changes

- Tests: the counter's edit sends the stored identity and captured price for
  kept lines and none for an added one; the live adapter keeps identities across
  a server-read order paid and taken back before it is edited; the demo adapter
  keeps them across a revision and through its queue.
- The demo adapter mints each new line's identity when the command is accepted,
  as the live one does, and keeps a stored line's identity on revision.
- The live adapter reads an order line through `orderLineView()`, which always
  carries the stored identity; a bill line is read through `lineView()`, which
  never does. Both adapters strip the identity from a provisional bill's lines.
- `docs/LIMITATIONS.md` narrows the entry to what remains: a **new** sale or
  order rung offline at an old price is still refused, because it has no stored
  line to compare. That remainder is recorded as a todo,
  `openspec/todos/an-offline-sale-keeps-its-price.md`, at the owner's direction
  [owner, 2026-10-09]: noted, not designed here.

## Not changing, and why

- **No migration.** The server rule is right and already tested.
- **The demo adapter does not refuse a line at an old price.** Its counter adds
  a new line only at the menu's current price and the demo has no price-change
  race across a queue, so the refusal would be unreachable code that a demo
  could only ever show by accident.
- **Nothing a biller sees changes.** Same screens, same words; only identities
  carried underneath.
- **No spec delta.** `counter-billing` ("A price changes mid-order") and
  `service-and-packaging` ("The price changes while an order is open") already
  require a captured line to keep its price; this pins that requirement at the
  counter.
