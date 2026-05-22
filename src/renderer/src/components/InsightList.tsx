import React from 'react'
import type { Insight } from '../../../main/insights/insight-detector'

interface InsightListProps {
  /** The ranked dynamic insights to surface. */
  insights: Insight[]
  /** Called with the insight to answer when its row is clicked. */
  onAnswer: (insight: Insight) => void
  /** Disables every insight button (for example while a query is in flight). */
  disabled: boolean
}

// The dynamic-insight surface shown below the command bar during an active
// session. Each insight is a button: clicking it (or pressing Tab for the
// first one, handled in App) answers it via the Codex context-ask path. The
// component renders nothing when there are no insights.
export function InsightList({
  insights,
  onAnswer,
  disabled
}: InsightListProps): React.JSX.Element | null {
  if (insights.length === 0) return null
  return (
    <div className="insight-list">
      {insights.map((insight) => (
        <button
          key={insight.id}
          className="insight-list__item"
          disabled={disabled}
          onClick={() => onAnswer(insight)}
        >
          <span className="insight-list__kind">{insight.kind}</span>
          <span className="insight-list__label">{insight.label}</span>
        </button>
      ))}
    </div>
  )
}
