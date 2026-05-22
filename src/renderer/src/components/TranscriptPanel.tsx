import React from 'react'
import type { TranscriptSegment } from '../../../shared/types'

interface TranscriptPanelProps {
  segments: TranscriptSegment[]
}

export function TranscriptPanel({ segments }: TranscriptPanelProps): React.JSX.Element {
  return (
    <div className="transcript-panel">
      {segments.length === 0 ? (
        <p className="panel__empty">No transcript yet</p>
      ) : (
        segments.map((segment) => (
          <p key={segment.id} className="transcript-panel__line">
            <span className="transcript-panel__speaker">{segment.speaker}</span>
            <span className="transcript-panel__text">{segment.text}</span>
          </p>
        ))
      )}
    </div>
  )
}
