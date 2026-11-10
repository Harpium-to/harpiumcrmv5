import { describe, expect, it } from 'vitest'

import { measureHeader, placeShortcuts, SHORTCUT_SIZE } from './shortcuts.js'

// ---------------------------------------------------------------------
// The real header, measured in WhatsApp Web on 10/11/2026 (1440px wide,
// panel collapsed): the name button from 496 to 1096, its text ending
// at 711, six 40px buttons from 1104, and two hidden labels further
// right.
// ---------------------------------------------------------------------

const HEADER = { left: 496, right: 1440, top: 0, height: 64 }
const BUTTONS = [
  { left: 496, right: 1096, width: 600 },
  ...[1104, 1160, 1216, 1272, 1328, 1384].map((left) => ({ left, right: left + 40, width: 40 })),
]
const TEXTS = [
  { left: 567, right: 711 },
  { left: 567, right: 662 },
  { left: 1085, right: 1163 }, // a hidden label, past the buttons
  { left: 1113, right: 1247 },
]

describe('measureHeader', () => {
  it('finds where the name ends and WhatsApp’s buttons start', () => {
    expect(measureHeader(HEADER, BUTTONS, TEXTS)).toEqual({ nameRight: 711, actionsLeft: 1104 })
  })

  it('without buttons, the header’s end; without text, its start', () => {
    expect(measureHeader(HEADER, [], [])).toEqual({ nameRight: 496, actionsLeft: 1440 })
  })
})

describe('placeShortcuts', () => {
  const { nameRight, actionsLeft } = measureHeader(HEADER, BUTTONS, TEXTS)

  it('sits between the name and the buttons, all of it when it fits', () => {
    const place = placeShortcuts({ header: HEADER, nameRight, actionsLeft, want: 8 })
    expect(place.count).toBe(8)
    expect(place.left).toBeGreaterThan(nameRight)
    expect(place.left + 8 * SHORTCUT_SIZE + 8).toBeLessThan(actionsLeft)
    expect(place.top).toBe(14)
  })

  it('gives up its last shortcuts when the room is short', () => {
    // The panel docked: the chat is 720px wide.
    const header = { left: 400, right: 1120, top: 0, height: 64 }
    const place = placeShortcuts({ header, nameRight: 615, actionsLeft: 784, want: 8 })
    expect(place.count).toBe(4)
    expect(place.left).toBeGreaterThan(615)
  })

  it('hides rather than squeeze below the minimum', () => {
    // Measured in WhatsApp Web with the panel open: the chat is 720px
    // wide, its text runs to 705 and its buttons start at 784. The
    // panel itself has every shortcut then.
    const header = { left: 400, right: 1120, top: 0, height: 64 }
    expect(placeShortcuts({ header, nameRight: 705, actionsLeft: 784, want: 8 })).toBeNull()
  })

  it('needs a header to sit in', () => {
    expect(placeShortcuts({ header: null, nameRight: 0, actionsLeft: 0, want: 8 })).toBeNull()
    expect(placeShortcuts({ header: HEADER, nameRight, actionsLeft, want: 0 })).toBeNull()
  })
})
