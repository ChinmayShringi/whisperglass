import React from 'react'

interface EyeToggleProps {
  invisible: boolean
  onToggle: () => void
}

export function EyeToggle({ invisible, onToggle }: EyeToggleProps): React.JSX.Element {
  return (
    <button
      className="eye-toggle"
      aria-label={`Invisible: ${invisible ? 'on' : 'off'}`}
      onClick={onToggle}
    >
      {invisible ? 'Eye off' : 'Eye'}
    </button>
  )
}
