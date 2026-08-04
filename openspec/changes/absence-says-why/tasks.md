## 1. Derive the cause once

- [x] 1.1 Add `explainAbsence` to `attendance-record.ts`, returning the sentence and the manager's own words for a day that reads absent, and nothing for a day that does not.
- [x] 1.2 Key the wording on the latest decision that set the status to absent, not on the decision kind alone, so a denial, a correction and a legacy outcome each read as what they were.
- [x] 1.3 Unplanned, found in the browser: the first draft explained a row waiting for its *first* decision, which is stored `absent` and is not an absence — so it contradicted the "waiting for a manager" verdict directly above it. Three readers had been asking that question separately, so `isAbsence` now names it and the verdict, the tally and the reason all read the same answer.

## 2. Render it once, behind the chevron

- [x] 2.1 Add the shared `AbsenceReason` component to `evidence.tsx`, named to a screen reader rather than left as loose prose.
- [x] 2.2 Show it in the roll-call's expanded details and in the range card's, and give both details for a deadline-derived absence so it has something to open onto.
- [x] 2.3 Correct `attendance-card.tsx`'s stated rule about a row with nothing beneath it, which an absence is now an exception to.

## 3. Pin it

- [x] 3.1 One roll-call test covering both shapes of absence on one screen, verified to fail before the fix.
- [x] 3.2 Narrow the existing no-toggle test — which turned out to have been green for the wrong reason. It named three derived readings and only ever found the absence: `not yet arrived` always carries a manual-entry action, and neither it nor `working at another outlet` was on the day it looked at. It now asserts the one row that genuinely has nothing beneath it, on a day where that row exists.
- [x] 3.3 Tighten the employee's own derived-absence test to assert the sentence, since it is the surface the symmetry promise is about. Verified to fail without the renderer.

## 3b. Sharpen the wordings, after reading them back

- [x] 3b.1 Tell a denial from a correction by what the day counted as before, from `previousStatus`, rather than by two similar sentences the reader has to weigh. A re-affirmed absence says it was reviewed and kept, because naming a previous outcome identical to the current one is not a fact.
- [x] 3b.2 Collapse the migrated-placeholder wording into the no-decision one. `legacy_outcome` cannot be an absence: 20260802000001's backfill inserts a decision only for a row with an approver or a status other than absent, and that kind is its `else` branch. Confirmed against production, which holds exactly one `legacy_outcome` row, `new_status: present`.
- [x] 3b.3 Pick the decision by kind, not by `newStatus`. `allow_retry` records `absent` as its new status while changing only retry permission, so the newest-absent-status rule would have replaced "denied the check-in" with "kept it absent" the moment a manager reopened a retry.
- [x] 3b.4 Unit-cover the four wordings the demo fixtures cannot reach — correction, re-affirmation, reopened retry, and no decision at all — in the module that decides them. The correction path was also walked in the app, since a real manager reaches it in two taps.

## 3c. Address the reader

- [x] 3c.1 `explainAbsence` takes the reader's id and the day's subject id, and speaks to the person whose day it is. Two nulls do not read as a match, or every day would address a reader who may be anybody.
- [x] 3c.2 A manager reading their own decision back is named in the second person. One substitution rather than a second set of sentences, because English past tense does not inflect for person.
- [x] 3c.3 `AbsenceReason` reads the viewer from the session rather than a prop, so no call site can claim somebody else's day belongs to the reader. `RangeDayList` states whose days it is listing, which its two callers answer differently.
- [x] 3c.4 Assert the failure that matters: a manager expanding somebody else's absence is not told they failed to check in. Covered on the roll-call and at the derivation, and both voices walked in the app.

## 3d. Say it in fewer words, and say the right thing

- [x] 3d.1 Cut the padding. The card's heading is the date and the person, so neither is named again; the verdict above says "Absent", so no sentence restates it. Fourteen words became five.
- [x] 3d.2 Name the deadline instead of describing it. `readDay` already computed the instant and threw it away, so it now carries it — the latest of a person's outlets, being the one whose passing decided the absence.
- [x] 3d.3 Delete the re-affirmed-absence wording. `correct_absent` on an already-absent day is `Keep absent and prevent another check-in`, reachable only after a denial, so it moved nothing and its sentence displaced the denial that was the real cause. Named the distinction as `madeTheDayAbsent`, since this is the second kind to have drifted into it after `allow_retry`.
- [x] 3d.4 Drop the icon from the sentence. The verdict directly above already carries the struck-through circle meaning absent.
- [x] 3d.5 Pin the retry-lock case with a test proved to fail against the old rule, and shorten the screen-reader labels to `Why absent:` and `Reason:`.

## 4. Record it

- [x] 4.1 Spec delta: an absent day states its cause on every surface.
- [x] 4.2 `docs/SCREENS.md`: the rule that a verdict somebody may dispute carries its cause, the corrected no-chevron rule, and the note that an unapproved check-in is not an absence.

## 5. GATE

- [x] 5.1 **Gate**: every absent day on all three surfaces opens onto one sentence saying why, a manager-decided one naming them and their words, a deadline one naming the deadline; the other two derived readings still carry no chevron. Ran `npm run typecheck`, `npm run lint`, `npm run format:check`, and the attendance, insights, shell, attention and demo suites (161 tests). Walked all three surfaces in the browser in dark and light, including the denied-then-retried day.
