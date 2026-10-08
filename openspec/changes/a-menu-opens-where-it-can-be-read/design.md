# Design: a-menu-opens-where-it-can-be-read

No RLS policy, money arithmetic or offline semantics is touched. This is
placement of two transient panels and nothing else.

## D1. One placement rule, pure, in `src/components/ui/anchored-panel.ts`

`placeAnchoredPanel({ trigger, panel, area, prefer, align })` returns the
panel's top-left in window coordinates, and the side it chose:

1. Try the preferred side, 4 px from the trigger. It fits if the whole panel is
   at least 8 px inside the area.
2. Otherwise try the other side.
3. If neither fits, take the side with more room.
4. Then clamp `top` and `left` into the area's 8 px margin, so the panel can
   overlap its own trigger but never leave the screen.

The area is the window less the chrome fixed over its edges (D3).

`align: 'end'` lines the panel's right edge with the trigger's, as both menus do
today; `'start'` lines up the left edges.

It is a pure function so its cases are tested without a layout engine, which
jsdom does not have.

## D2. `useAnchoredPanel` keeps it beside the trigger while it is open

The hook measures the trigger and the rendered panel, places it before first
paint (a layout effect, with the panel hidden until then), and re-places it every
animation frame while open. The frame loop is what follows a card that slides
under an open menu, which fires no scroll or resize event. It writes state only
when the position actually moves, so an idle open menu costs two rectangle reads
a frame and no renders. Where `requestAnimationFrame` does not exist it falls back to
scroll and resize listeners, which is what both menus used. (Vitest's jsdom
does provide it, so the component tests run the loop.)

**A sliding card is a containing block.** `useFlip` slides a card with a CSS
transform, and a transformed ancestor makes `position: fixed` relative to that
ancestor instead of the window. The hook therefore does not trust its own
coordinates: each frame it compares where the panel actually is with the
position its committed style gives it, and subtracts the difference. The
committed style, not the last position it asked for: a frame can land before
React has written that, and the offset would then be measured against a style
the panel is not yet wearing. Outside a slide the
difference is zero; during one it is the transformed card's offset, and the
panel stays put on screen beside its trigger.

## D3. Chrome over an edge says so: `data-window-edge`

The phone's navigation bar is fixed over the window's foot, and the demo
counter's banner is sticky over its top (above a menu, at z-40). Measured to the
window, a row just above the bar had room below and opened its menu over the bar,
which the owner caught in the first build [2026-10-08]. Such chrome carries
`data-window-edge="top"` or `"bottom"`, and `usableArea()` moves the area's edge
to it. An element not drawn has no size and moves nothing, so the bar, which is
`md:hidden`, is an edge on a phone and not on a tablet; and an open navigation
group, which grows the bar upward, raises the edge with it.

## Rejected alternatives

- **Find fixed chrome automatically**, by scanning for `position: fixed` or
  `sticky` elements at the window's edges. It would also find the form sheet, a
  dialog, the flip ghosts and every menu itself, and the rule for telling them
  apart would be the marking anyway, guessed at.

- **Portal the panel to `document.body`.** It would escape the transform
  without any correction, but the panel would leave its card. About ten
  component and end-to-end tests find a card's menu rows inside the card, and so
  does anyone reading the accessibility tree from the card. Correcting by the
  measured offset keeps the panel where it is read.
- **Close the menu when its card moves.** Simple, but a menu vanishing because
  another till's order left the rail reads as the counter changing its mind
  under the biller's thumb.
- **Fix only the pipeline card.** The row menu has the mirror defect, below the
  screen, and the next menu written would copy whichever one it was next to.
- **Scroll the page to fit the menu.** Moving the page under somebody who has
  just tapped is worse than moving the panel.
