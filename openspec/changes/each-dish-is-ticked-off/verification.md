# Verification: each-dish-is-ticked-off

Task 7.2, walked 2026-10-15 between 11:50 and 11:57 IST by Claude, on production's
published build `da92417`. The walk used the demo at `ops.shawarmania.in/demo`,
which runs the same screens as the counter and kitchen against fabricated data. It
was done in the desktop app's browser pane with its viewport and colour scheme
emulated.

## Both gates on (the demo's default)

- **Counter, tablet width (1280×800), light and dark.** The counter shows the menu
  beside the two-column order rail. Ticking the only dish on #96 ticked it, and
  #96 left the kitchen board when the demo was switched to the kitchen in the same
  tab. Dark follows the system theme once the page is reloaded.
- **Kitchen, tablet width, dark.** ACK on #105, then Ready: the ticket collapsed
  to its number with a green tick. Back on the counter, #105's dish was filled
  orange with its bell.
- **Phone width (390×844).** The kitchen fits with no sideways overflow in light
  and dark. The counter's page does not overflow either (scroll width 391 of 391);
  its order rail scrolls sideways inside the counter, as designed.

## Both gates off

The gates were turned off on the demo's own Change gates page. Turning off Dish
ticks took Kitchen Ready and Instant saves with it, as their dependency says.

- **Counter, tablet width.** The three columns are back: menu, then Bills this
  shift and cash, then the order rail with one **Prepared** tick per order. There
  are no dish ticks, labels or notes.
- **Kitchen.** Tickets carry ACK only, with no Ready.
- **Phone width.** Neither the counter nor the kitchen overflows the page.

The demo's *Start again* put every gate back on afterwards.

## Console and network

Every request the demo made was for the app's own static files on
`ops.shawarmania.in` (the document, scripts, styles and fonts), and none went to
Supabase. The console logged one `net::ERR_BLOCKED_BY_CLIENT` per page load, for a
request that does not appear in the network list. It is read as the browser pane
refusing a resource, not as the app. The same pages in the owner's own browser
logged no errors.

## Production, the same morning

- **The pull.** The owner turned `dish-ticks` and `kitchen-ready` off at 09:23 IST
  and Claude turned them back on from the owner's session at 11:47, after
  `tablet-health` and `probe`. The owner's own browser picked up every gate within
  a minute, with no reload: its build stamp read `da92417·PB-TH-DT-KR-OT-IS`.
- **Real use.** Both gates ran through the service on 14 October: 94 dish ticks
  and 40 kitchen Readies, with no failed requests reported by either tablet.

## Noticed, not fixed

- At phone width with the gates on, the unavailable tile *Lebanese Chicken
  Shawarma* breaks its name mid-word ("Lebane se Chicke n Shawar ma"), because its
  Unavailable label squeezes it. At tablet width it reads whole. The counter runs
  on a tablet, so this is cosmetic.
- The tablets had not reported since 23:58 on 14 October. The build carrying
  `d1704ae3`'s follow-ups (the owner's Orders tab, one composer row per dish, the
  bell at rest) has therefore not run through a service yet.
