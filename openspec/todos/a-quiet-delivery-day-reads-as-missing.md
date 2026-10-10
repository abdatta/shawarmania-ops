# A quiet delivery day reads as missing

**Type**: Gap · **Status**: Open, owner asked 2026-10-10 · **Area**: Overview / aggregator sync

Overview's revenue tile says **Delivery data incomplete** whenever any day in its range has no figures recorded for a delivery channel the outlet has switched on. That is deliberate — a day with no row is not proven to be a day with no orders — but it also fires on every day a listing genuinely took no orders, because the readers record only days that had orders. An outlet whose delivery listings are quiet (for example, listings kept switched on mainly so their sessions stay alive and their charges stay visible) therefore carries the qualifier on almost every range, and the owner learns to ignore it, which defeats it.

What makes it non-trivial: telling "no orders" from "not read" needs a record of which days a successful read actually covered. A closed settlement week is read whole, so its quiet days are known zeros; the week in progress is read from order history only when it has orders, and a channel's same-day reading can come back empty for reasons other than a quiet day. Writing zero rows, or treating a run's read window as coverage, changes what a day row means for every reader of it.

Promote when the owner asks again, or when a change already reworks what the readers record for a day.
