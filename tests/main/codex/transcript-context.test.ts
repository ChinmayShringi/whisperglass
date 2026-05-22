import { describe, it, expect } from 'vitest'
import { buildTranscriptContext } from '../../../src/main/codex/transcript-context'
import type { TranscriptSegment } from '../../../src/shared/types'

function seg(id: string, speaker: TranscriptSegment['speaker'], text: string): TranscriptSegment {
  return { id, speaker, text }
}

describe('buildTranscriptContext', () => {
  it('returns an empty string for no segments', () => {
    expect(buildTranscriptContext([], { recentSegments: 12, olderCharBudget: 1200, olderMarker: '[earlier in the meeting]' })).toBe('')
  })

  it('keeps every segment verbatim when the count is within the recent window', () => {
    const segments = [seg('1', 'you', 'hello there'), seg('2', 'them', 'hi back')]
    const result = buildTranscriptContext(segments, {
      recentSegments: 12,
      olderCharBudget: 1200,
      olderMarker: '[earlier in the meeting]'
    })
    expect(result).toContain('you: hello there')
    expect(result).toContain('them: hi back')
    expect(result).not.toContain('[earlier in the meeting]')
  })

  it('keeps the most recent N verbatim and digests the rest under the marker', () => {
    const segments = Array.from({ length: 20 }, (_, i) =>
      seg(String(i), i % 2 === 0 ? 'you' : 'them', `line ${i}`)
    )
    const result = buildTranscriptContext(segments, {
      recentSegments: 5,
      olderCharBudget: 1200,
      olderMarker: '[earlier in the meeting]'
    })
    expect(result).toContain('[earlier in the meeting]')
    // The 5 most recent (lines 15..19) appear verbatim with a speaker prefix.
    expect(result).toContain('them: line 19')
    expect(result).toContain('you: line 16')
    // An older line is part of the digest, not a verbatim recent line.
    expect(result).toContain('line 0')
  })

  it('truncates the older digest to the char budget', () => {
    const segments = Array.from({ length: 60 }, (_, i) =>
      seg(String(i), 'you', `a fairly long transcript line number ${i} with filler words`)
    )
    const budget = 200
    const result = buildTranscriptContext(segments, {
      recentSegments: 4,
      olderCharBudget: budget,
      olderMarker: '[earlier in the meeting]'
    })
    const markerIndex = result.indexOf('[earlier in the meeting]')
    const recentIndex = result.indexOf('you: a fairly long transcript line number 56')
    const digest = result.slice(markerIndex, recentIndex)
    // The digest body (excluding the marker line) stays within the budget.
    expect(digest.length).toBeLessThanOrEqual(budget + '[earlier in the meeting]'.length + 4)
  })

  it('does not mutate the input segments array', () => {
    const segments = [seg('1', 'you', 'one'), seg('2', 'you', 'two')]
    const copy = segments.map((s) => ({ ...s }))
    buildTranscriptContext(segments, {
      recentSegments: 1,
      olderCharBudget: 50,
      olderMarker: '[earlier in the meeting]'
    })
    expect(segments).toEqual(copy)
  })

  it('puts the digest before the recent verbatim segments', () => {
    const segments = Array.from({ length: 10 }, (_, i) => seg(String(i), 'you', `line ${i}`))
    const result = buildTranscriptContext(segments, {
      recentSegments: 3,
      olderCharBudget: 1200,
      olderMarker: '[earlier in the meeting]'
    })
    expect(result.indexOf('[earlier in the meeting]')).toBeLessThan(result.indexOf('line 9'))
  })
})
