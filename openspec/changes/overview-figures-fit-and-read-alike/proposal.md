# Proposal: overview-figures-fit-and-read-alike

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · corrects `outlets-overview` · **Gate**: none — display formatting on the owner's Overview and Analytics, away from the counter's run time, and a revert cleanly undoes it; `outlets-overview.test.tsx` and `money.test.ts` pass, and the new Overview test fails with the fix reverted.

## Why

Overview's headline figure dropped to a smaller size as soon as it reached ₹10,00,000, whatever the screen: on a laptop *October revenue ₹10,50,141* went small beside a full-size *₹10,872*, with room to spare (owner, 2026-10-30). Its supporting amounts switched to short form only from ₹10,000, so one caption read *Expenses ₹10.4L · Ahead ₹2,114* and *Left ₹1,100 · Spent ₹23.1k*; Analytics shortened from ₹1,000 with a capital K, and a figure just under a unit rounded up inside it, *₹100k* for ₹99,990.

## What Changes

- **Headline size by measurement**: a headline is drawn at its regular size and drops to the smaller one only when the regular size overruns its cell, as today's open orders and the caption already do. Where a figure has a second one beside it, the headline shrinks last, after the icon is left out.
- **One short form**: every shortened amount has at most three significant digits, trailing zeros dropped, in Indian units: *₹950*, *₹2.11K*, *₹12.5K*, *₹1.25L*, *₹10.5L*, *₹2.5Cr*. A value that rounds up to a unit's limit moves to the next unit (*₹1L*, never *₹100K*). Overview's captions always use it, whatever the size, so a caption never mixes the two forms. Analytics' short labels (chart axis, *Usually* range) use the same formatter, so both pages write *K*. Counts in Analytics use it without the rupee sign.
- The formatter is `compactPaise` in `src/domain/money.ts`, beside `formatPaise`, so a third page cannot invent its own.

## Non-goals

- Headlines and exact figures keep full rupees; the hover title keeps exact paise.
- Today's open orders stay exact (the `outlets-overview` requirement names them so).
- *Sept*: the `en-IN` short month, used by every date the app formats, stays as it is; changing it on Overview alone would make the mismatch the owner was asking about.
- No spec delta: `outlets-overview` asks for weight by size and figures that fit without wrapping, which measuring keeps; it does not specify the short form.
