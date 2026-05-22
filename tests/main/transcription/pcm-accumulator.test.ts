import { describe, it, expect } from 'vitest'
import {
  createPcmAccumulator,
  pushPcm,
  type PcmAccumulatorState
} from '../../../src/main/transcription/pcm-accumulator'

// 16 kHz mono 16-bit PCM: 2 bytes per sample, 32000 bytes per second.
// windowBytes = 8 s = 256000; overlapBytes = 2 s = 64000.
const WINDOW_BYTES = 256_000
const OVERLAP_BYTES = 64_000

function frame(byteLength: number, fill: number): Buffer {
  return Buffer.alloc(byteLength, fill)
}

describe('pcm-accumulator', () => {
  it('starts empty and emits no window', () => {
    const state = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    expect(state.buffered.length).toBe(0)
  })

  it('buffers frames without emitting until a full window is reached', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    const result = pushPcm(state, frame(32_000, 1))
    state = result.state
    expect(result.window).toBeNull()
    expect(state.buffered.length).toBe(32_000)
  })

  it('emits a window of exactly windowBytes once enough audio is buffered', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    let emitted: Buffer | null = null
    for (let i = 0; i < 8; i += 1) {
      const result = pushPcm(state, frame(32_000, i + 1))
      state = result.state
      if (result.window) emitted = result.window
    }
    expect(emitted).not.toBeNull()
    expect(emitted?.length).toBe(WINDOW_BYTES)
  })

  it('retains exactly the trailing overlap after emitting a window', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    for (let i = 0; i < 8; i += 1) {
      state = pushPcm(state, frame(32_000, i + 1)).state
    }
    expect(state.buffered.length).toBe(OVERLAP_BYTES)
  })

  it('does not mutate the input state', () => {
    const state = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    pushPcm(state, frame(32_000, 1))
    expect(state.buffered.length).toBe(0)
  })

  it('emits a window whose tail bytes equal the retained overlap', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    let emitted: Buffer | null = null
    for (let i = 0; i < 8; i += 1) {
      const result = pushPcm(state, frame(32_000, i + 1))
      state = result.state
      if (result.window) emitted = result.window
    }
    const tail = emitted!.subarray(WINDOW_BYTES - OVERLAP_BYTES)
    expect(Buffer.compare(tail, state.buffered)).toBe(0)
  })
})
