import { describe, it, expect } from 'vitest'
import { dedupOverlap } from '../../../src/main/transcription/overlap-dedup'

describe('dedupOverlap', () => {
  it('returns the whole new text when there is no previous text', () => {
    expect(dedupOverlap('', 'hello there friend')).toBe('hello there friend')
  })

  it('drops a trailing-leading word overlap between consecutive windows', () => {
    const previous = 'welcome to the meeting today'
    const next = 'the meeting today we will discuss the budget'
    expect(dedupOverlap(previous, next)).toBe('we will discuss the budget')
  })

  it('returns an empty string when the new text is fully contained in the previous tail', () => {
    expect(dedupOverlap('one two three four', 'three four')).toBe('')
  })

  it('returns the whole new text when there is no shared overlap', () => {
    expect(dedupOverlap('completely different words', 'nothing matches here')).toBe(
      'nothing matches here'
    )
  })

  it('matches the longest overlap, not a shorter accidental one', () => {
    const previous = 'the cat sat on the mat'
    const next = 'on the mat and then it slept'
    expect(dedupOverlap(previous, next)).toBe('and then it slept')
  })

  it('is case-insensitive and whitespace-tolerant when matching the overlap', () => {
    const previous = 'Discuss the Quarterly Budget'
    const next = 'the quarterly budget   in detail'
    expect(dedupOverlap(previous, next)).toBe('in detail')
  })

  it('returns an empty string when next is empty', () => {
    expect(dedupOverlap('anything here', '')).toBe('')
  })
})
