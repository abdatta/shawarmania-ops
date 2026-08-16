# Design: billing-history-two-controls

## D1 — The day bar moves out of the manual ledger rather than being copied

The bar this surface wants exists, in `features/manual-ledger`, and that folder
is documented as a stopgap: *"a stopgap with a known end date, and the whole
folder goes when it ends"*. Importing from it would make the deletion of a
temporary notebook a breakage in billing, which is exactly what that comment
exists to prevent.

Copying it instead is the other way to get there and is worse for the ordinary
reason: two bars, one idiom, and the next correction applied to one of them.

So `PeriodBar` and its day field move to `components/ui/period-bar.tsx`, where a
surface that outlives the ledger may hold them, and the ledger imports them from
there like anybody else. It is a move, not a rewrite: the behaviour, the markup
and the reasons in the comments come with it. Test ids gain a prefix — `ledger-`
for the ledger, `billing-history-` here — so both surfaces stay addressable
without either owning the component's names.

Attendance keeps its own `RangePicker`. It answers a different question (which
month) and shares only a silhouette; merging it is a change of its own and this
one does not need it.

## D2 — The average bill is integer paise, and an empty day is zero

Money is integer paise, so the average is `Math.round(total / count)` and never
a float carried into a card. Rounding rather than truncating, because an average
is a reading of the day and not an amount anyone is owed: half a paise down is a
figure that reads wrong against the takings beside it, and nothing reconciles
against this number.

A day with no paid bills has no average, and a card that reads `NaN` or `∞` is
worse than one that reads `₹0`. The count is checked before the division rather
than after it, so the zero is a deliberate answer rather than a formatting
accident.

`Total` is the sum of the same Cash and UPI figures rather than a separate read,
so the three money cards always reconcile: whatever the tender split says, the
total is its sum, and the average is that total over the same set of bills.

## D3 — One read, filtered in the surface, not two reads

Removing the pickers leaves the surface asking `listManagerHistory` for one
outlet-day with no status or payment narrowing, which is a superset of the
`settled` read the totals used. So the totals derive their bills from the list
the surface already has instead of asking for them again.

The adapter keeps both parameters. The counter uses them, their tests cover
them, and a parameter nobody passes is cheaper to keep than a signature change
rippling through two adapters and their suites.
