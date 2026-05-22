export interface PcmAccumulatorState {
  /** PCM bytes buffered so far, not yet emitted as a window. */
  readonly buffered: Buffer
  /** Window size in bytes. */
  readonly windowBytes: number
  /** Overlap size in bytes, retained after each emitted window. */
  readonly overlapBytes: number
}

export interface PushPcmResult {
  state: PcmAccumulatorState
  /** A full window of exactly windowBytes, or null when not yet ready. */
  window: Buffer | null
}

// Creates an empty rolling-window accumulator. windowBytes and overlapBytes
// are derived from WHISPER timing by the caller (8 s window, 2 s overlap).
export function createPcmAccumulator(
  windowBytes: number,
  overlapBytes: number
): PcmAccumulatorState {
  return { buffered: Buffer.alloc(0), windowBytes, overlapBytes }
}

// Appends a PCM frame. When the buffer reaches a full window it emits exactly
// windowBytes and retains the trailing overlapBytes for the next window so
// consecutive windows overlap. Immutable: returns a new state, never mutates.
export function pushPcm(state: PcmAccumulatorState, frame: Buffer): PushPcmResult {
  const combined = Buffer.concat([state.buffered, frame])
  if (combined.length < state.windowBytes) {
    return { state: { ...state, buffered: combined }, window: null }
  }
  const window = combined.subarray(0, state.windowBytes)
  const retained = Buffer.from(combined.subarray(state.windowBytes - state.overlapBytes))
  return {
    state: { ...state, buffered: retained },
    window: Buffer.from(window)
  }
}
