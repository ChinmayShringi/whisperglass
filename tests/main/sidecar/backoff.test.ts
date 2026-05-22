import { describe, it, expect } from 'vitest'
import { backoffDelayMs } from '../../../src/main/sidecar/backoff'

describe('backoffDelayMs', () => {
  it('returns the base delay for the first attempt', () => {
    expect(backoffDelayMs(1, 1000, 8000)).toBe(1000)
  })

  it('doubles the delay each attempt', () => {
    expect(backoffDelayMs(2, 1000, 8000)).toBe(2000)
    expect(backoffDelayMs(3, 1000, 8000)).toBe(4000)
    expect(backoffDelayMs(4, 1000, 8000)).toBe(8000)
  })

  it('caps the delay at the maximum', () => {
    expect(backoffDelayMs(5, 1000, 8000)).toBe(8000)
    expect(backoffDelayMs(20, 1000, 8000)).toBe(8000)
  })

  it('treats attempt 0 or negative as the base delay', () => {
    expect(backoffDelayMs(0, 1000, 8000)).toBe(1000)
    expect(backoffDelayMs(-3, 1000, 8000)).toBe(1000)
  })
})
