export interface AccumulatorState {
  full: string
}

export interface AccumulateResult {
  state: AccumulatorState
  delta: string
}

export function createAccumulator(): AccumulatorState {
  return { full: '' }
}

export function accumulate(state: AccumulatorState, text: string): AccumulateResult {
  if (text === state.full) {
    return { state, delta: '' }
  }
  if (text.startsWith(state.full)) {
    return { state: { full: text }, delta: text.slice(state.full.length) }
  }
  return { state: { full: state.full + text }, delta: text }
}
