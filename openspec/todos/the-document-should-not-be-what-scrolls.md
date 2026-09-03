# The Document Should Not Be What Scrolls

**Type**: Gap · **Status**: Open, found 2026-09-03 · **Area**: App shell

## Expectation

Nothing on a screen moves sideways because of how tall the content happens to
be. A row a reader is about to touch stays where it was.

## Current behaviour

The page itself scrolls, so on Windows and Linux a surface is 15px narrower when
its content is tall enough to need a scrollbar and 15px wider when it is not.
Everything on it shifts between those two states.

It shows up wherever content crosses the height of the viewport:

- Switching between the counter walkthrough and a phone role in the demo, where
  the whole indicator strip and its four role tabs move together. This is where
  it was found.
- A filtered list that empties, or fills past the fold.
- A day with fewer bills than the day before it.
- An expanded bill collapsing.

Phones and Macs are unaffected: they overlay their scrollbars, so there is
nothing to reserve and nothing to lose.

## What was tried and reverted

`scrollbar-gutter: stable` on the root, which does fix it, and was reverted the
same day. It reserves the scrollbar's track whether or not it is needed, so it
charges 15px of permanently empty gutter on **every** screen — including the
counter tablet, where horizontal room is the scarcest thing on the app and the
whole menu is meant to be visible without scrolling. Paying that on every till,
all day, to stop a demonstrator's role tabs moving is the wrong trade.

Recording it so it is not proposed again as if it were free.

## The route that costs nothing

Stop the document scrolling and let the app's own regions scroll instead, so a
page-level scrollbar never exists and no width is ever reserved or lost.

Most of this shape is already in place, which is what makes it worth doing
rather than inventing:

- The counter tablet already scrolls its own columns. Its shift column was given
  a fixed head and a scrolling body precisely so a busy evening could not run
  its last bills off the screen.
- The phone shells already own the viewport with a flex column, with the
  navigation bar fixed at the bottom.

So the work is to make that universal and load-bearing rather than incidental,
and the risk is entirely in what it would break: anything relying on the page
scrolling, sticky positioning measured against the document, the installed
PWA's address-bar behaviour on mobile, and the browser tests that scroll a page
to assert something is reachable.

## Why it is not scheduled

It touches all four shells at once, for a 15px cosmetic shift. It wants its own
change with its own gate, and a reason to be done — most likely the next time
somebody is working across the shells anyway, or the first time the shift
actually costs a mis-tap at the counter rather than an eyebrow in a demo.

## Trigger to promote

Somebody mis-taps because a row moved under their thumb, or a change is already
opening all four shells for another reason.
