import { describe, expect, it } from 'vitest'

import { PANEL_GAP_PX, VIEWPORT_MARGIN_PX, placeAnchoredPanel } from './anchored-panel'

const area = { top: 0, bottom: 720, left: 0, right: 1280 }
const panel = { width: 176, height: 100 }

function trigger(top: number, left = 1200, size = 36) {
  return { top, bottom: top + size, left, right: left + size }
}

describe('placeAnchoredPanel', () => {
  it('opens on the preferred side when the whole panel fits there', () => {
    const placed = placeAnchoredPanel({
      trigger: trigger(400),
      panel,
      area,
      prefer: 'above',
      align: 'end',
    })
    expect(placed).toEqual({
      side: 'above',
      top: 400 - PANEL_GAP_PX - panel.height,
      left: 1236 - panel.width,
    })
  })

  it('opens on the other side when the preferred one has no room', () => {
    // The top card of a counter scrolled down to its expenses.
    const above = placeAnchoredPanel({
      trigger: trigger(0),
      panel,
      area,
      prefer: 'above',
      align: 'end',
    })
    expect(above).toMatchObject({ side: 'below', top: 36 + PANEL_GAP_PX })

    // The last row of a list at the foot of the window.
    const below = placeAnchoredPanel({
      trigger: trigger(700, 40),
      panel,
      area,
      prefer: 'below',
      align: 'start',
    })
    expect(below).toMatchObject({ side: 'above', top: 700 - PANEL_GAP_PX - panel.height })
  })

  it('measures room to the chrome over the window, not to the window', () => {
    // A row just above the phone's bottom bar, whose top is at 590: the window
    // has room below the trigger, the screen a person can read does not.
    const placed = placeAnchoredPanel({
      trigger: trigger(520, 40),
      panel,
      area: { ...area, bottom: 590 },
      prefer: 'below',
      align: 'start',
    })
    expect(placed).toMatchObject({ side: 'above', top: 520 - PANEL_GAP_PX - panel.height })
  })

  it('takes the roomier side and stays on screen when neither side fits', () => {
    const tall = { width: 176, height: 500 }
    const placed = placeAnchoredPanel({
      trigger: trigger(300),
      panel: tall,
      area,
      prefer: 'above',
      align: 'end',
    })
    // 384 px below against 300 above, and held inside the margin, overlapping
    // its own trigger rather than leaving the screen.
    expect(placed.side).toBe('below')
    expect(placed.top).toBe(area.bottom - VIEWPORT_MARGIN_PX - tall.height)
  })

  it('holds the panel inside the window horizontally at either edge', () => {
    const atLeft = placeAnchoredPanel({
      trigger: trigger(400, 0),
      panel,
      area,
      prefer: 'above',
      align: 'end',
    })
    expect(atLeft.left).toBe(VIEWPORT_MARGIN_PX)

    const atRight = placeAnchoredPanel({
      trigger: trigger(400, 1270),
      panel,
      area,
      prefer: 'above',
      align: 'start',
    })
    expect(atRight.left).toBe(area.right - VIEWPORT_MARGIN_PX - panel.width)
  })
})
