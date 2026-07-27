# Capture Outlet Location In The App

**Type**: Feature · **Status**: Wanted for attendance · **Area**: Outlets

## Expectation

Someone standing at the counter opens the app and records that spot as the outlet's location, from the device they are holding. They set the geofence radius at the same time, and can see how accurate the fix was before saving it.

## Current behaviour

There is no outlet screen at all — the surface is declared but not built, so coordinates can only be written by an administrator running SQL against the database.

That is not merely inconvenient, it is the wrong shape for the job. Whoever runs the SQL is at a keyboard, not at the counter, so the coordinates have to come from a map search — and every document in this repo warns against exactly that, because the geofence is computed against them. A wrong fix either blocks staff who are present or admits staff who are not.

The concrete case that surfaced it: the owner who has the database access is not physically at either outlet, and the co-owner who is there has no way to record what he can see.

## Why it is small

**The database already allows it.** A Super Admin can insert and update outlets — the policy and the grant exist and are covered by the isolation suite. Nothing about permissions, tenancy or the data model needs to change. What is missing is a screen.

**Attendance is already building the hard part.** Reading a position from the device, judging whether the fix is good enough to trust, and explaining a bad one to a person are all things the check-in flow has to do anyway. Capturing an outlet's own position reuses that, rather than introducing anything new.

## Why it belongs with attendance rather than later

Attendance cannot go live without outlet coordinates, so this is on its critical path whether or not it ships in the same change. Doing it separately means someone hand-writing production SQL in the meantime — a manual step in the launch runbook that exists only because a screen is missing.

The alternative is to wait for the outlet-onboarding change, which owns outlet management properly. That is the right long-term home; the question is only whether attendance can go live before it.

## Open questions

- **What accuracy is good enough to save?** A phone indoors can report a fix that is confidently wrong. Storing the reported accuracy alongside the position, and refusing or warning on a poor one, matters more here than for a check-in — every future check-in is judged against this one number.
- **Should it capture once, or average a few readings?** A single sample at a counter surrounded by concrete may be worse than several taken over a few seconds.
- **Who may do it?** Editing outlets is Super Admin only in the capability matrix. If the person standing in the shop is the Franchise Admin rather than an owner, either the matrix changes or the owner does it on a visit.
- **What radius?** 150 m is the owner-confirmed default, but it was chosen before anyone measured either shop.

## Trigger to promote

Now — fold it into `attendance` (#5) unless that change is already too large, in which case it is the first thing `outlet-onboarding` should build.

**Dependencies when seeded**: `auth-and-roles` (#4).
