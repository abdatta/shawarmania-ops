# The Pipeline Rename Left Two Sentences Behind

**Type**: Design gap · **Status**: Open · **Area**: Counter billing

## Expectation

The living specs describe the counter workspace the way the counter actually
works: a menu column, a middle column holding **Bills this shift** that gives way
to the composer, and an activity column holding the outlet's preparation
pipeline — **Preparing** over **Unpaid Prepared Orders**.

## Current behaviour

`preparing-order-pipeline` (#45) rewrote that workspace and renamed it
everywhere user-visible, but its spec delta covered `counter-billing`,
`order-lifecycle`, `billing-delivery` and `billing-command-contract` only. Two
sentences describing the same workspace lived elsewhere. The `app-shell`
sentence was corrected by `extended-offline-billing` (#34); one contradiction
remains:

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

A one-line correction to the `counter-billing` composer scenario so it says
Preparing. No code changes: the app already behaves that way.

## Trigger

Already wired into the two changes that edit these capabilities, so this does
not wait on somebody thinking to read the backlog:

- **`multiple-billing-devices` (#35), task 3.8** takes the `counter-billing`
  half. #35 depends on #34 and its delta already carries that corrected
  scenario.

**#34 archived on 2026-09-02** and took the `app-shell` half with it, so one
contradiction remains: the composer scenario in the living `counter-billing`
spec still ends in **Open orders** while the requirement eight lines below it
says **Preparing**.

#35's delta carries the corrected scenario inside its MODIFIED
`The composer supports immediate payment and saving an order`, which is the
requirement that sentence lives in, so **archiving #35 closes this note** with
no separate edit. There is no code change either way: the app has said Preparing
everywhere it shows a person anything since #45.
