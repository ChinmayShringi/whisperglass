import React from 'react'
import { DEFAULT_ACTIONS } from '../../../main/codex/default-actions'
import type { DefaultActionId } from '../../../shared/types'

interface DefaultActionsProps {
  /** Called with the chosen Default Action id. */
  onAction: (id: DefaultActionId) => void
  /** Disables every button (for example while a query is in flight). */
  disabled: boolean
}

// A row of black-and-white Default Action buttons. Each maps to a preset
// prompt from the shared DEFAULT_ACTIONS table; clicking one hands its id to
// the parent, which sends the matching context-ask query.
export function DefaultActions({ onAction, disabled }: DefaultActionsProps): React.JSX.Element {
  return (
    <div className="default-actions">
      {DEFAULT_ACTIONS.map((action) => (
        <button
          key={action.id}
          className="default-actions__button"
          disabled={disabled}
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
