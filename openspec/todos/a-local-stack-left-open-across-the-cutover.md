# A local stack left open across the cutover expires its shifts

**Type**: Verification gap · **Status**: Open · **Area**: Testing

A seeded local stack is only good for the trading day it was seeded on. Its counter shifts expire at the outlet's next cutover, as real ones do, so a stack seeded in the evening and still running after 04:00 IST holds no open shift: REST billing probes and anything else that bills through a seeded tablet fail, and keep failing until the stack is reset. A fresh `npx supabase db reset` fixes it.

It never affects CI, which seeds a fresh stack for every run, and nothing is wrong with the shifts: they are genuinely over. The cost is a confusing local failure after a long session or an overnight pause, which reads like a regression in whatever was just changed.

History: this note began on 2026-09-08 as a wider report, in which fixtures that labelled rows with the UTC calendar date also failed between 04:00 IST and UTC midnight. That part was fixed and proved on CI inside the window by `the-suite-gives-the-same-answer-all-day` (archived 2026-10-03), which left this case behind.

Promote if a long local session crossing the cutover becomes a regular way of working. The likely shape is a check in the local verification commands that notices expired seeded shifts and says to reset. Shift expiry itself does not change.
