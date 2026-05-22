import React from 'react'
import type { CodexAnswerStatus } from '../hooks/useCodexAnswer'

interface AnswerPanelProps {
  answer: string
  status: CodexAnswerStatus
  error?: string
  onRetry?: () => void
}

export function AnswerPanel({
  answer,
  status,
  error = '',
  onRetry,
}: AnswerPanelProps): React.JSX.Element {
  if (status === 'error') {
    return (
      <div className="answer-panel answer-panel--error">
        <p className="answer-panel__error">{error || 'Something went wrong.'}</p>
        {onRetry && (
          <button className="answer-panel__retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }

  const hasText = answer.trim().length > 0
  if (!hasText) {
    return (
      <div className="answer-panel">
        <p className="panel__empty">{status === 'streaming' ? 'Thinking...' : 'No answer yet'}</p>
      </div>
    )
  }

  return (
    <div className="answer-panel">
      <p className="answer-panel__text">{answer}</p>
    </div>
  )
}
