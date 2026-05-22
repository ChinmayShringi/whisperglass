// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInsights } from '../../../src/renderer/src/hooks/useInsights'
import type { TranscriptSegment } from '../../../src/shared/types'

function seg(id: string, text: string): TranscriptSegment {
  return { id, speaker: 'them', text }
}

describe('useInsights', () => {
  it('returns no insights when the session is inactive', () => {
    const segments = [seg('1', 'when do we ship?')]
    const { result } = renderHook(() => useInsights(segments, false))
    expect(result.current.insights).toEqual([])
  })

  it('detects insights from the transcript while the session is active', () => {
    const segments = [seg('1', 'when do we ship?'), seg('2', 'I had lunch')]
    const { result } = renderHook(() => useInsights(segments, true))
    expect(result.current.insights).toHaveLength(1)
    expect(result.current.insights[0].kind).toBe('question')
  })

  it('exposes the first insight as firstInsight', () => {
    const segments = [seg('1', 'what is the budget?')]
    const { result } = renderHook(() => useInsights(segments, true))
    expect(result.current.firstInsight?.sourceSegmentId).toBe('1')
  })

  it('firstInsight is undefined when there are no insights', () => {
    const { result } = renderHook(() => useInsights([], true))
    expect(result.current.firstInsight).toBeUndefined()
  })
})
