import { describe, it, expect } from 'vitest'
import { nextPosition } from '../../../src/main/windows/position'

describe('nextPosition', () => {
  it('moves up by the step', () => {
    expect(nextPosition([100, 200], 'move-up', 40)).toEqual([100, 160])
  })

  it('moves right by the step', () => {
    expect(nextPosition([100, 200], 'move-right', 40)).toEqual([140, 200])
  })

  it('moves down by the step', () => {
    expect(nextPosition([100, 200], 'move-down', 40)).toEqual([100, 240])
  })

  it('moves left by the step', () => {
    expect(nextPosition([100, 200], 'move-left', 40)).toEqual([60, 200])
  })

  it('returns the same coordinates for a non-move action', () => {
    expect(nextPosition([100, 200], 'show-hide', 40)).toEqual([100, 200])
  })

  it('returns the same coordinates for toggle-invisibility', () => {
    expect(nextPosition([100, 200], 'toggle-invisibility', 40)).toEqual([100, 200])
  })

  it('returns a new array, not the same reference as the current argument', () => {
    const current: [number, number] = [100, 200]
    const result = nextPosition(current, 'move-up', 40)
    expect(result).not.toBe(current)
  })
})
