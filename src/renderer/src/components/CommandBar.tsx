import React, { useState, type KeyboardEvent } from 'react'

interface CommandBarProps {
  onSubmit: (question: string) => void
  disabled?: boolean
}

export function CommandBar({ onSubmit, disabled = false }: CommandBarProps): React.JSX.Element {
  const [value, setValue] = useState('')

  function submit(): void {
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    onSubmit(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="command-bar">
      <input
        className="command-bar__input"
        placeholder="Ask anything..."
        aria-label="Question input"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button className="command-bar__submit" onClick={submit} disabled={disabled}>
        Ask
      </button>
    </div>
  )
}
