import { describe, expect, it } from 'vitest'

import { isDarkColor, pickMode } from './theme.js'

// ---------------------------------------------------------------------
// The panel follows the theme WhatsApp is actually showing, read from
// the colour it painted. A colour that says nothing must come back
// null, so the next candidate (or the system preference) decides.
// ---------------------------------------------------------------------

describe('isDarkColor', () => {
  it("reads WhatsApp's dark and light backgrounds", () => {
    expect(isDarkColor('rgb(17, 27, 33)')).toBe(true)
    expect(isDarkColor('rgb(12, 19, 23)')).toBe(true)
    expect(isDarkColor('rgb(240, 242, 245)')).toBe(false)
    expect(isDarkColor('rgb(255, 255, 255)')).toBe(false)
  })

  it('accepts the rgba and space-separated forms', () => {
    expect(isDarkColor('rgba(17, 27, 33, 1)')).toBe(true)
    expect(isDarkColor('rgb(240 242 245 / 100%)')).toBe(false)
  })

  it('accepts color(srgb …), which Chrome returns for newer syntaxes', () => {
    expect(isDarkColor('color(srgb 0.07 0.1 0.13)')).toBe(true)
    expect(isDarkColor('color(srgb 0.94 0.95 0.96 / 1)')).toBe(false)
  })

  it('says nothing about a transparent background', () => {
    expect(isDarkColor('rgba(0, 0, 0, 0)')).toBeNull()
    expect(isDarkColor('rgb(0 0 0 / 10%)')).toBeNull()
    expect(isDarkColor('color(srgb 0 0 0 / 0)')).toBeNull()
  })

  it('says nothing about what it cannot read', () => {
    expect(isDarkColor('oklch(0.2 0.01 72)')).toBeNull()
    expect(isDarkColor('transparent')).toBeNull()
    expect(isDarkColor('')).toBeNull()
    expect(isDarkColor(undefined)).toBeNull()
    expect(isDarkColor(42)).toBeNull()
  })
})

describe('pickMode', () => {
  it('lets the first colour that says something decide', () => {
    expect(pickMode(['rgba(0, 0, 0, 0)', 'rgb(17, 27, 33)', 'rgb(255, 255, 255)'], false)).toBe('dark')
    expect(pickMode(['rgb(240, 242, 245)', 'rgb(17, 27, 33)'], true)).toBe('light')
  })

  it('falls back to the system preference', () => {
    expect(pickMode(['rgba(0, 0, 0, 0)', ''], true)).toBe('dark')
    expect(pickMode([], false)).toBe('light')
    expect(pickMode(undefined, true)).toBe('dark')
  })
})
