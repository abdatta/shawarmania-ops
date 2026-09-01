# Design: A Degraded Sync Is Visible

## D1. A partial run reuses the outcome vocabulary rather than extending it

**Decision.** No sixth outcome word. A run that wrote some of what it read is
recorded with the word naming *why* it fell short — `shape_changed` for a changed
portal contract, `reconciliation_failed` for a payout that did not add up — and
its `summary` carries what it nonetheless moved. Partial is therefore
`outcome <> 'ok'` **with a non-empty summary**; total is the same outcome with an
empty one.

**Why not a `partial` word.** It was the first instinct and it is wrong twice.

It answers the wrong question. The outcome column exists to *route*: the comment
on it in `sync.mjs` says so, and the surface's own vocabulary is a set of actions
— reconnect, tell a maintainer, accept the difference. `partial` routes nowhere.
An owner reading `partial` has to ask what broke before they can do anything, and
the word that answers that is the word we would have replaced.

And it would put the same fact in two places. `session_lapsed` and `partial` are
not alternatives — a lapse mid-run *is* partial. So either the word pair becomes
`partial` plus a second column saying why, or the six words become a matrix of
reason × completeness that the check constraint cannot express and every reader
has to decompose.

The completeness half is already recorded, exactly, by the field built to record
it. #48's summary is determined inside the write transaction and is empty for a
run that moved nothing. Reading emptiness off it is not derivation-after-the-fact
of the kind that migration warns about; the movement was recorded when it was
knowable, and this reads that record.

**Cost accepted.** `outcome <> 'ok'` alone no longer means "wrote nothing", and
one existing sentence assumed it did (`finish`'s "A run that reached no data at
all"). That sentence is corrected rather than left to be rediscovered.

## D2. Precedence when a run degrades and its writes also degrade

A request can now carry a declared degradation *and* produce one. Both are real
and only one word can be recorded, so the order is stated once here:

1. **A refused cycle wins** (`shape_changed`, 422). The write contract rejected a
   payload; that is a maintainer's problem and the loudest thing that happened.
   Unchanged behaviour, including that already-committed cycles keep their
   summary.
2. **A reconciliation failure wins over a declared degradation**
   (`reconciliation_failed`, 200). It is about money that does not add up, which
   outranks a read that came back short, and the declared reason is appended to
   the detail so neither is lost.
3. **Otherwise the declared degradation is recorded**, with its own detail and
   the summary of what was written.

The declared word never *upgrades* a run: a caller declaring `ok` alongside
cycles is treated exactly as a caller declaring nothing, which is what it means.

## D3. Stopped is computed from the cadence, at one and a half intervals

**Decision.** A channel has stopped when the time since its last run exceeds
`1.5 × (24 / readsPerDay)`. At the current four reads a day that is nine hours.

**Why derived from the reported cadence and not a constant.** The constant is the
mistake this repository already made once: `READS_PER_DAY_FALLBACK` said "twice a
day" for weeks after the readers moved to four, because the cadence was prose here
about crons in another repository. Since #48 the runner parses its own cron and
reports it with every run, so the threshold moves when the schedule does and
nothing here has to be told. The fallback remains only for a channel nothing has
reported for.

**Why one and a half intervals.** One interval cries wolf: GitHub's scheduler runs
late, the sync repository's own workflow comments put it at ten to fifteen minutes,
and observed runs drift further under load. Two intervals is a whole missed read
plus a whole grace period — twelve hours at today's cadence, which is most of the
outage this change exists to shorten. One and a half is longer than any lateness
observed and still fires *before* the following read is due, so the surface says
"a read was due and did not happen" while that is still news.

**Why at read time rather than as a stored flag.** Staleness is a claim about the
run that did **not** happen. Nothing can record it, because the process that would
have is the process that is missing. A scheduled job to write the flag would be
one more thing whose own silence goes unnoticed, which is the bug.

**What it does not do.** It does not fire on a channel that has never run
(`Never run` already says that, and is not a fault), nor on one not switched on
for the outlet, nor on a run currently under way. And it never *replaces* a
failure word: a channel that is both stuck and overdue reads as stuck, because
that is the more specific and more actionable statement.

## D4. Where the word lives

`hasGoneQuiet` goes in `when.ts` beside `readAgainAfterHours`, which already
derives an hour count from the same cadence. Both are the same kind of fact and a
reader comparing them should not have to look in two files. The surface keeps the
choice of word; `when.ts` keeps the arithmetic.

The chosen word is **`Overdue`**, not `Gone quiet`. `All quiet` is the healthy
word on this surface, and a fault word sharing most of its letters with the
healthy one is a fault word nobody reads.
