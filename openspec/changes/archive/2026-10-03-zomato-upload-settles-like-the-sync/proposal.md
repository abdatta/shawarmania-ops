# Proposal: zomato-upload-settles-like-the-sync

> **Model**: Opus · **Kind**: correction to shipped behaviour (no roadmap row) ·
> **Gate**: an uploaded Zomato payout workbook for a week Zomato has not paid is
> refused, the owner reads why on the upload screen, and nothing is written; a
> workbook for a paid week settles that week under the same cycle the sync uses,
> with its deductions, TDS and additions, and only if it reconciles against
> Zomato's own totals in the same file; a week the ledger already holds settled
> is left alone and the owner is told whether the file agrees; and the sync
> settles a Zomato week only once Zomato calls it PAID.

> **This change has a companion in the private sync repo**
> (`abdatta/shawarmania-sync`, branch `zomato-settles-only-when-paid`). That half
> is built, tested and rehearsed against production; merging it is a task here,
> because both halves implement one rule: a Zomato week is final when Zomato has
> paid it.

## Why

From 28 Sep 22:12 UTC to 30 Sep 10:37 UTC every Zomato run for Kalyani reported
`reconciliation_failed` on the week of 21-27 Sep, and the owner's Delivery card
read "Stuck". Nothing was wrong with the money. Zomato's payout list showed that
week as ₹9,443.52, already net of a ₹961.50 Hyperpure bill it had collected, from
the night after the week closed; its expenses tab did not list that bill until the
morning of the payout two days later. The sync settled every closed week
immediately, so it compared a finished payout with a half-built deduction list.
The week reconciled by itself on the first run after the list caught up.

The owner asked for two things [owner, 2026-09-30]:

1. Fix the sync so this does not recur.
2. Make the **manual upload** do exactly what the sync does. When the sync is down,
   a workbook downloaded from Zomato is the only way figures reach the ledger. An
   incomplete or TO BE PAID workbook must be refused **with the reason clearly
   stated**.

Checking the upload turned up more than the owner asked about. Today it:

- settles every uploaded week, paid or not, and a settled day is final;
- states the payout as the sum of the file's own order payouts, so the
  reconciliation gate compares a number with itself and cannot fail;
- drops every deduction, TDS line and addition the workbook lists;
- guesses the week from the first and last order dates, so a week whose Monday had
  no Zomato order is filed under a second cycle reference beside the sync's;
- silently skips orders from a restaurant it cannot map, and can "succeed" having
  written nothing;
- and shows every refusal as "That upload did not go through", because the screen
  reads the reason from a `Response` object as if it were the parsed body.

## What changes

For the owner, on the Delivery page's statement upload:

- **A Zomato workbook for a week not yet paid is refused, and says so**: *"Zomato
  has not paid 21 Sep – 27 Sep yet: 54 of 55 orders are still pending settlement.
  Upload this week's workbook after its payout date."* Nothing is written.
- **A paid week settles as the sync would settle it.** Same cycle, same
  per-day gross, commission and net. The Hyperpure bills, ads, TDS and additions
  the workbook lists are all accounted for. The upload is written only if those add
  up to the payout Zomato's own totals describe; if they do not, it is refused with
  both amounts and the difference.
- **A week the ledger already holds settled is not rewritten.** The owner is told
  it is already settled and whether the file agrees with it, to the paisa.
- **Every refusal reads as its reason**, for every statement kind, not only
  Zomato's.

In the sync (companion repo): a closed Zomato week goes in **provisional** until
Zomato marks it **PAID**, still showing each day's commission and net from the
workbook, and settles on the first run after payment.

## Non-goals

- **The confirmation flow for restating a closed period** (statement-uploads'
  "asks first" requirement). This change refuses rather than restates; building
  the confirmation step is its own change.
- **Resolving the TDS 194O question.** The 27 Jul-02 Aug workbook lists a
  cycle-level `TDS 194O` of ₹311.24 that the sync assumes lives inside order
  payouts. No week since the sync went live has carried one, so there is no paid
  week to prove either reading. The upload follows Zomato's own formula; the sync
  is left as it is and the gate will name the amount the first time it matters.
- **One identity for a Zomato deduction across both paths.** The sync keys a
  deduction on the expenses tab's expense id; the workbook carries the invoice or
  campaign id instead. Hyperpure bills, the only deductions seen since go-live,
  are written by Hyperpure's own reader and skipped from both. See design D6.
- **Reading a Zomato workbook covering more than one restaurant.** It is refused
  with the reason; the portal downloads one outlet at a time.

## Docs to update before archive

- `docs/OPERATIONS.md` — the manual Zomato recovery path: which file, when (after
  the payout date), what a refusal means.
- `docs/LIMITATIONS.md` — the deduction-identity gap (D6) and the open TDS question.
- `docs/SCREENS.md` — the upload refusals the owner can see.
