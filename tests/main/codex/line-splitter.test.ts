import { describe, it, expect } from 'vitest'
import { splitLines } from '../../../src/main/codex/line-splitter'

describe('splitLines', () => {
  it('returns complete lines and keeps the trailing partial as rest', () => {
    const result = splitLines('', 'one\ntwo\nthr')
    expect(result.lines).toEqual(['one', 'two'])
    expect(result.rest).toBe('thr')
  })

  it('prepends the previous buffer before splitting', () => {
    const result = splitLines('thr', 'ee\nfour\n')
    expect(result.lines).toEqual(['three', 'four'])
    expect(result.rest).toBe('')
  })

  it('returns no lines when the chunk has no newline', () => {
    const result = splitLines('ab', 'cd')
    expect(result.lines).toEqual([])
    expect(result.rest).toBe('abcd')
  })
})
