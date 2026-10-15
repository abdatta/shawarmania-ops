# A phone sheet hangs from the top

**Type**: Gap · **Status**: Open, found 2026-10-14 · **Area**: App shell

## Expectation

On a phone, a sheet (Add person, Count & Collect, Edit outlet and the rest)
rises from the bottom of the screen, which is what its rounded top corners and
top border say it is.

## Current behaviour

Measured in the production build while checking `a-popup-closes-when-you-tap-outside-it`:
at 375 × 812 and at 412 × 915 the sheet's top edge sits at the very top of the
screen and it ends 120–150 px above the bottom, so the strip of dimmed screen is
**below** it. The rounded corners and the top border are then drawn at the top
edge of the screen. A sheet on a tablet or laptop is a panel on the right edge
and is not affected.

The browser's own styling for a modal dialog fixes its top edge to the top of
the screen; the sheet fixes only its bottom edge and sets no top, so the two
disagree and the dialog keeps the top. It reads as unintended, but only the
owner can say whether a sheet hanging from the top is wanted.

## Why it is not in the change that found it

That change is about how a pop-up closes. It aims its phone test at whichever
strip of backdrop is larger, so it holds either way, and changing where every
phone sheet sits is a visual decision across thirty-two sheets that deserves its
own look in both themes.

## Trigger to promote

The owner sees it and wants it changed, or a change reworks the sheet.
