---
name: release
description: Release a deployed Shawarmania change by turning its change gate on — check readiness, choose a quiet hour, tell the owner exactly what to turn and watch on the Change gates page, watch the tablets through the next service, pull the gate once, and say when to turn it off. Use when the user asks to release, enable, turn on, or go live with a deployed change, or asks whether one is ready to switch on.
---


# Release

A change reaches production **off**. Releasing it is turning its change gate on,
and only the owner can: `set_change_gate` takes the authority from their own
token, and nothing an agent holds can turn a production gate. So this workflow is
everything around that one tap — making sure it is safe, choosing the moment,
telling the owner exactly what to do and what to watch, and reading what happens.
`docs/RELEASES.md` is the full account; AGENTS.md → *Every change can be turned
off* has the rules.

Talk to the owner in plain words and name the screens: "the account menu, top
right → **Change gates** → **Dish ticks**". Never your shorthand.

## 1. Preconditions — stop at the first that fails, and say which

1. **Find the gates.** Every entry in `src/change-gates/gates.ts` whose `change`
   is this change. A change may have several; one that depends on another is
   released after it.
2. **It is deployed.** A Deploy run succeeded on a commit containing the change
   (`gh run list --workflow deploy.yml --limit 5`), and the gate's page lists it,
   **Off**. A gate the page does not list has no row in production yet.
3. **It was tested both ways on that commit:** the Verify jobs with gates off and
   with gates on were green.
4. **Every gate it depends on is on.** The page refuses otherwise and names them.
5. **The tablets have the build.** The gate's page lists every tablet and the
   build it is running. A tablet on an older build does not know the gate and
   keeps running as before (unknown is off), so it is safe, but it will not run
   the change until it updates — say which tablets those are.
6. **Note the baseline.** The page shows each tablet's requests, failures and
   slowest request; note each tablet's readings for a few minutes before the turn.

## 2. Choose the hour

Outside service, which runs about 17:00–23:00 IST on the counters, and on a day
the owner can watch the next service from start to finish. Late morning to mid
afternoon is the usual window. Read the time in IST from something that honours
it — `node -e "console.log(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))"`
— because Git Bash ignores `TZ`. If it is service time, say so and wait.

## 3. Turn it on — the owner does this

Tell the owner, in order: account menu → **Change gates** → the gate → the switch
at the top → a reason ("Release after the demo was approved") → confirm. Each
tablet reloads into the change at its next free moment — never in the middle of
a bill — usually within a minute or two of being idle.

## 4. Watch

On the gate's page, under **Tablets**, each tablet moves from *waiting* to
*running*. Then, through the next service, read each tablet's line against its
baseline. Turn it off at once, and investigate after, if any of these holds for
more than a minute or two:

- **failed** above zero on any tablet;
- **slowest** above about 3 seconds;
- **requests** well above the baseline — twice it is a flood starting (on
  12 October the counter went from about 40 a minute to 600);
- a tablet goes **Silent**;
- anybody at the counter or in the kitchen says something is wrong.

A tablet still *waiting* while it is busy is not a problem: its free moment has
not come.

## 5. Pull it once

At the next quiet moment after the first service — the same night after close,
or the next morning — the owner turns it **off**, watches every tablet follow to
*running* the off state, then turns it **on** again and watches them follow back.
A gate nobody has pulled is a gate nobody knows works, and archiving the change
refuses until the history shows this pull.

## 6. When it goes wrong

**Off first.** Off is the behaviour as it was before, the one answer both test
runs proved safe. Turning a gate off also turns off every gate that depends on
it; the confirmation names them. Then fix behind the same gate — no new gate —
deploy, and release again from step 1. If turning off is not enough (the counter
is down), the ladder continues in `docs/RELEASES.md`: Republish the last good
build, then Hotfix.

## 7. Report

One line each: the gates and their codes; when each was turned on and by whom
(the page's history); every tablet's state and readings after the first service;
whether the pull has happened; anything that went wrong and what was done. If
the pull is done and real use has gone well, the next step is `$openspec-archive-change`.
