# The Pipeline Rename Left Two Sentences Behind

**Type**: Design gap · **Status**: Open · **Area**: Counter billing / Shell

## Expectation

The living specs describe the counter workspace the way the counter actually
works: a menu column, a middle column holding **Bills this shift** that gives way
to the composer, and an activity column holding the outlet's preparation
pipeline — **Preparing** over **Unpaid Prepared Orders**.

## Current behaviour

`preparing-order-pipeline` (#45) rewrote that workspace and renamed it
everywhere user-visible, but its spec delta covered `counter-billing`,
`order-lifecycle`, `billing-delivery` and `billing-command-contract` only. Two
sentences describing the same workspace live elsewhere and were never carried
across, so they now contradict the requirements beside them:

- **`app-shell`, "Billing lifecycle surfaces are gated by context and
  readiness"** still says the Counter surface combines the composer, **this
  tablet's open orders** and this shift's bills. The pipeline has been
  outlet-wide since #45 — another tablet's work is this counter's work, shown
  with its creator — and the middle column is Bills this shift, not the open
  orders list. The same paragraph names the resizable pair the
  "current-bill and activity columns", where `counter-billing` now says "middle
  and activity".

- **`counter-billing`, "The composer supports immediate payment and saving an
  order"** has a scenario ending "the order appears in **Open orders**", while
  its sibling requirement two screens away says a saved order "appears in
  **Preparing** immediately". One capability, two names for one rail.

Neither sentence is wrong about anything that matters to money or isolation, and
no reader of the app is misled — the code says Preparing everywhere it shows a
person anything. The standalone page and the manager's history tab genuinely do
keep the plain **Open orders** heading, by the owner's call against "Pipeline",
so those uses are correct and should stay.

## Why this was not simply missed at archive

The archive step merges what a change's delta contains. #45's delta never
proposed an `app-shell` edit, so there was nothing to merge, and the
`counter-billing` scenario sat inside a requirement #45 did not modify. Both
survived because the rename was scoped to the requirements #45 rewrote rather
than to every sentence in the estate describing the same surface.

Found on 2026-08-31 while reviewing the seven archives of 2026-08-30.

## What would close it

A delta on `app-shell` restating the Counter workspace in the vocabulary
`counter-billing` now uses — outlet-wide pipeline, middle column, Bills this
shift — and a one-line correction to the composer scenario so it says Preparing.
No code changes: the app already behaves the way the corrected sentences would
describe.

## Trigger

Already wired into the two changes that edit these capabilities, so this does
not wait on somebody thinking to read the backlog:

- **`extended-offline-billing` (#34), task 3.5** takes the `app-shell` half. It
  modifies that capability anyway.
- **`multiple-billing-devices` (#35), task 3.6** takes the `counter-billing`
  half, and the `app-shell` half too if #34 did not. #35 depends on #34, so
  ordinarily #34 goes first and #35 only has the scenario left to correct.

Whichever of the two runs last closes this note. If both are reordered or
dropped, the trigger falls back to the next change touching either capability.
