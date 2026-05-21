import { describe, it, expect } from 'vitest'
import { createAccumulator, accumulate } from '../../../src/main/codex/answer-accumulator'

describe('answer accumulator', () => {
  it('starts empty', () => {
    expect(createAccumulator().full).toBe('')
  })

  it('returns the whole first text as the delta', () => {
    const result = accumulate(createAccumulator(), 'Hello')
    expect(result.delta).toBe('Hello')
    expect(result.state.full).toBe('Hello')
  })

  it('returns only the new suffix when text grows cumulatively', () => {
    const first = accumulate(createAccumulator(), 'Hello')
    const second = accumulate(first.state, 'Hello there')
    expect(second.delta).toBe(' there')
    expect(second.state.full).toBe('Hello there')
  })

  it('emits no delta when the text is unchanged', () => {
    const first = accumulate(createAccumulator(), 'Hello')
    const second = accumulate(first.state, 'Hello')
    expect(second.delta).toBe('')
  })

  it('appends when new text is not a continuation of the old text', () => {
    const first = accumulate(createAccumulator(), 'Hello')
    const second = accumulate(first.state, 'World')
    expect(second.delta).toBe('World')
    expect(second.state.full).toBe('HelloWorld')
  })

  it('does not mutate the input state', () => {
    const start = createAccumulator()
    accumulate(start, 'Hello')
    expect(start.full).toBe('')
  })
})
