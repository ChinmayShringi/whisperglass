import React from 'react'

interface AnswerPanelProps {
  answer: string
}

export function AnswerPanel({ answer }: AnswerPanelProps): React.JSX.Element {
  return (
    <div className="answer-panel">
      {answer.trim().length === 0 ? (
        <p className="panel__empty">No answer yet</p>
      ) : (
        <p className="answer-panel__text">{answer}</p>
      )}
    </div>
  )
}
