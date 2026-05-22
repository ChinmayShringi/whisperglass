// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { downsampleTo16k, floatToInt16Pcm } from '../../../src/renderer/src/audio/downsample'

describe('downsampleTo16k', () => {
  it('returns the input unchanged when the source rate is already 16 kHz', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1])
    const output = downsampleTo16k(input, 16_000)
    expect(Array.from(output)).toEqual([0, 0.5, -0.5, 1])
  })

  it('halves the sample count when downsampling 32 kHz to 16 kHz', () => {
    const input = new Float32Array(32)
    const output = downsampleTo16k(input, 32_000)
    expect(output.length).toBe(16)
  })

  it('produces roughly a third of the samples when downsampling 48 kHz to 16 kHz', () => {
    const input = new Float32Array(48_000)
    const output = downsampleTo16k(input, 48_000)
    expect(output.length).toBe(16_000)
  })

  it('keeps the first sample when downsampling', () => {
    const input = new Float32Array([0.9, 0.1, 0.8, 0.2])
    const output = downsampleTo16k(input, 32_000)
    expect(output[0]).toBeCloseTo(0.9, 5)
  })
})

describe('floatToInt16Pcm', () => {
  it('converts 0 to 0', () => {
    const pcm = floatToInt16Pcm(new Float32Array([0]))
    expect(pcm.readInt16LE(0)).toBe(0)
  })

  it('converts 1 to the positive 16-bit maximum 32767', () => {
    const pcm = floatToInt16Pcm(new Float32Array([1]))
    expect(pcm.readInt16LE(0)).toBe(32_767)
  })

  it('converts -1 to -32767', () => {
    const pcm = floatToInt16Pcm(new Float32Array([-1]))
    expect(pcm.readInt16LE(0)).toBe(-32_767)
  })

  it('clamps values above 1 and below -1', () => {
    const pcm = floatToInt16Pcm(new Float32Array([2, -2]))
    expect(pcm.readInt16LE(0)).toBe(32_767)
    expect(pcm.readInt16LE(2)).toBe(-32_767)
  })

  it('produces 2 bytes per sample', () => {
    const pcm = floatToInt16Pcm(new Float32Array([0, 0.5, -0.5]))
    expect(pcm.length).toBe(6)
  })
})
