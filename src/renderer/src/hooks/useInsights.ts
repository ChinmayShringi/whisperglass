import { useMemo } from 'react'
import { detectInsights, type Insight } from '../insights/detect-insights'
import { INSIGHTS } from '../../../main/config/constants'
import type { TranscriptSegment } from '../../../shared/types'

export interface UseInsights {
  /** The ranked dynamic insights, empty while the session is inactive. */
  insights: Insight[]
  /** The first insight, the one the Tab hotkey answers. */
  firstInsight: Insight | undefined
}

// Runs the pure rule-based insight detector over the live transcript while a
// session is active. When the session is inactive it returns no insights, so
// the overlay surfaces insights only during a meeting (matching Cluely's
// session-scoped model). The detection itself is deterministic and memoized
// on the segments and the active flag.
export function useInsights(segments: TranscriptSegment[], active: boolean): UseInsights {
  const insights = useMemo(() => {
    if (!active) return []
    return detectInsights(segments, {
      keywords: INSIGHTS.keywords,
      maxSurfaced: INSIGHTS.maxSurfaced
    })
  }, [segments, active])

  return { insights, firstInsight: insights[0] }
}
