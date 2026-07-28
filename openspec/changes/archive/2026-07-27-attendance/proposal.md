# Proposal: attendance

> **Model**: Opus · **Wave**: B · **Depends on**: #3, #4 · **Gate**: **real staff check in and out on their own phones in production**; in-fence succeeds, out-of-fence blocks then clears via manager override recorded with who and why; an Employee sees only their own records; surface is `live`.

## Why

**The first genuine business value the project delivers**, and the reason attendance was pulled ahead of everything else: the business wants attendance tracked immediately rather than at the end of a long build.

It is also the simplest complete slice through auth, deployment and live data — a low-stakes shakedown of all three before billing depends on them. Anything wrong with the adapter seam, the RLS policies, or the deploy pipeline surfaces here, where the cost of finding it is small.

**This change builds its UI and goes live in one step**, unlike the surfaces in Wave C. The demo-first split exists to make *undeliverable* features demonstrable; for a feature shipping immediately it would be pure ceremony.

One consequence of skipping the split must not be skipped with it: **the attendance surfaces still register demo fixtures.** The Employee role's entire demo experience *is* attendance — without mock fixtures, the four-role walkthrough in #8 dead-ends on role four, because a demo session provably cannot touch real data. The screens ride the adapter seam anyway, so this is nearly free: implement the mock side of the attendance adapter and register the surface as `live` (which, per the gate table, shows in demo mode with demo data).

## Scope

**Employee** — home screen with one large check-in/check-out action, today's status, and own attendance history. Real geolocation capture: coordinates, accuracy, and computed distance to the outlet, stored on every check-in and check-out.

**The blocked state**, designed properly rather than as an error toast: why it was refused, how far outside the fence, and a clear path to request an override.

**Geofence policy** — block outside the radius, with Franchise Admin override. Requested from the employee's phone, approved from the manager's, recorded with approver and reason.

**Franchise Admin** — the outlet's attendance by day (who, when, from where, and any flags), the override approval action, and the employee roster with add/edit and employment status.

**Outlet location, captured in place** — whoever is standing at the counter records the outlet's position from the device in their hand, sets the geofence radius, and sees how accurate the fix was before saving it. Today there is no outlet screen at all, so coordinates can only be written by someone at a keyboard, from a map search — which is precisely what a geofence must not be built on. The database already allows it (the `outlets` update policy and grant exist, both covered by the isolation suite); what is missing is the screen, and this change is building the position-reading machinery anyway.

**Isolation test cases** for `employees` and `attendance`, including that an Employee reads only their own rows.

**Demo fixtures** — the mock side of the attendance adapter, with the states worth demonstrating: a normal day, a blocked check-in awaiting override, and an approved override. Consumed by #8's walkthrough.

## Design questions to settle during `/opsx:propose`

- **What accuracy is good enough to save as an outlet's position?** A phone indoors can report a fix that is confidently wrong, and every future check-in is judged against this one number. Refusing or warning on a poor fix matters more here than it does at check-in, where a bad reading costs one override rather than poisoning the reference point.
- **One reading, or several averaged?** A single sample at a counter surrounded by concrete may be worse than a few taken over several seconds.
- **Who may capture it?** Editing outlets is Super Admin only in the capability matrix. If the person standing in the shop is the Franchise Admin, either the matrix changes or an owner has to make the trip.
- **What radius?** 150 m is owner-confirmed, but it was chosen before anyone measured either shop.

## Non-goals

- **No counter-tablet fallback yet** — that needs enrolled devices and arrives with #9. Until then the manager override is the only escape hatch: workable, but a phone that cannot get a fix costs a manager approval.
- No payroll, leave approval, or shift rostering.

## Watch out for

**This is the first change that puts real people's data in production.** Two things follow. Browser geolocation is spoofable and drifts 20–100m indoors, so a location flag must never be presented as proof in a dispute about someone's pay — store the evidence and let a human judge. And location is captured at check-in and check-out **only**; there is no background tracking in this system, and adding any would need a deliberate decision in its own proposal.

The employee's own history must show **exactly** what the manager sees. Asymmetric visibility in a monitoring feature is how it becomes something staff resent.

## User-only gate steps

- ✅ Provision the production Supabase project and deploy — done 2026-07-27, along with auth, so this change lands on a working backend.
- 🧍 **Stand at each counter and capture the coordinates in the app.** No longer a SQL step: the point of building the capture screen is that this can only be done from the spot. It gates everything below it.
- 🧍 Onboard real staff and watch a full day of real check-ins before calling the gate passed.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md` (the monitoring section, once real capture exists), `docs/OPERATIONS.md` (production is now real).
