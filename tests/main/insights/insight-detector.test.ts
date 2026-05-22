import { describe, it, expect } from 'vitest'
import { detectInsights } from '../../../src/main/insights/insight-detector'
import type { TranscriptSegment } from '../../../src/shared/types'

function seg(id: string, text: string, speaker: TranscriptSegment['speaker'] = 'them'): TranscriptSegment {
  return { id, speaker, text }
}

const OPTS = {
  keywords: ['deadline', 'budget', 'action item'],
  maxSurfaced: 5
}

describe('detectInsights', () => {
  it('returns no insights for an empty transcript', () => {
    expect(detectInsights([], OPTS)).toEqual([])
  })

  it('detects a segment ending in a question mark as a question insight', () => {
    const insights = detectInsights([seg('1', 'Can you send the file?')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('question')
    expect(insights[0].sourceSegmentId).toBe('1')
  })

  it('detects an interrogative opener without a question mark', () => {
    const insights = detectInsights([seg('1', 'what is the current status')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('question')
  })

  it('detects a salient keyword as a keyword insight', () => {
    const insights = detectInsights([seg('1', 'we need to lock the budget today')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('keyword')
  })

  it('matches keywords case-insensitively', () => {
    const insights = detectInsights([seg('1', 'The DEADLINE moved up')], OPTS)
    expect(insights[0].kind).toBe('keyword')
  })

  it('matches a multi-word keyword', () => {
    const insights = detectInsights([seg('1', 'the first action item is mine')], OPTS)
    expect(insights[0].kind).toBe('keyword')
  })

  it('ignores plain statements that are neither a question nor a keyword', () => {
    expect(detectInsights([seg('1', 'I had coffee this morning')], OPTS)).toEqual([])
  })

  it('treats a segment as a question when it is both a question and a keyword', () => {
    const insights = detectInsights([seg('1', 'what is the budget?')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('question')
  })

  it('ranks questions before keyword insights', () => {
    const insights = detectInsights(
      [seg('1', 'the budget is tight'), seg('2', 'when do we ship?')],
      OPTS
    )
    expect(insights[0].kind).toBe('question')
    expect(insights[1].kind).toBe('keyword')
  })

  it('de-duplicates insights with the same normalized text', () => {
    const insights = detectInsights(
      [seg('1', 'When do we ship?'), seg('2', 'when do we ship?')],
      OPTS
    )
    expect(insights).toHaveLength(1)
  })

  it('caps the result at maxSurfaced', () => {
    const segments = Array.from({ length: 10 }, (_, i) => seg(String(i), `question ${i}?`))
    const insights = detectInsights(segments, { keywords: [], maxSurfaced: 3 })
    expect(insights).toHaveLength(3)
  })

  it('gives every insight a stable non-empty id and a label', () => {
    const insights = detectInsights([seg('1', 'what is next?')], OPTS)
    expect(insights[0].id.length).toBeGreaterThan(0)
    expect(insights[0].label.length).toBeGreaterThan(0)
  })

  it('does not mutate the input segments', () => {
    const segments = [seg('1', 'what now?')]
    const copy = segments.map((s) => ({ ...s }))
    detectInsights(segments, OPTS)
    expect(segments).toEqual(copy)
  })
})
