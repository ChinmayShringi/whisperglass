import React from 'react'

interface ListenToggleProps {
  listening: boolean
  onToggle: () => void
}

export function ListenToggle({ listening, onToggle }: ListenToggleProps): React.JSX.Element {
  return (
    <button
      className="listen-toggle"
      aria-label={`Listening: ${listening ? 'on' : 'off'}`}
      onClick={onToggle}
    >
      {listening ? 'Stop listening' : 'Start listening'}
    </button>
  )
}
