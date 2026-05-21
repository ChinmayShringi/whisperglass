import { describe, it, expect } from 'vitest'
import {
  createOverlayState,
  toggleInvisible,
  toggleClickThrough,
  setVisible
} from '../../../src/main/windows/overlay-state'

describe('overlay-state', () => {
  it('starts visible, not invisible, not click-through', () => {
    expect(createOverlayState()).toEqual({
      visible: false,
      invisible: false,
      clickThrough: false
    })
  })

  it('toggleInvisible returns a new object with invisible flipped', () => {
    const a = createOverlayState()
    const b = toggleInvisible(a)
    expect(b.invisible).toBe(true)
    expect(b).not.toBe(a)
    expect(a.invisible).toBe(false)
  })

  it('toggleClickThrough flips clickThrough immutably', () => {
    const b = toggleClickThrough(createOverlayState())
    expect(b.clickThrough).toBe(true)
  })

  it('setVisible sets the visible flag immutably', () => {
    const a = createOverlayState()
    const b = setVisible(a, true)
    expect(b.visible).toBe(true)
    expect(b).not.toBe(a)
  })

  it('toggleInvisible applied twice round-trips to the original state', () => {
    const a = createOverlayState()
    const b = toggleInvisible(toggleInvisible(a))
    expect(b).toEqual(a)
  })

  it('toggleClickThrough returns a new object reference', () => {
    const a = createOverlayState()
    const b = toggleClickThrough(a)
    expect(b).not.toBe(a)
  })

  it('toggleInvisible does not change clickThrough or visible', () => {
    const a = createOverlayState()
    const b = toggleInvisible(a)
    expect(b.clickThrough).toBe(a.clickThrough)
    expect(b.visible).toBe(a.visible)
  })

  it('setVisible(state, false) produces visible false', () => {
    const a = setVisible(createOverlayState(), true)
    const b = setVisible(a, false)
    expect(b.visible).toBe(false)
  })
})
