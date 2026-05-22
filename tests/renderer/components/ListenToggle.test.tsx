// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListenToggle } from '../../../src/renderer/src/components/ListenToggle'

describe('ListenToggle', () => {
  it('labels itself by the current listening state', () => {
    render(<ListenToggle listening={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Listening: on' })).toBeInTheDocument()
  })

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn()
    render(<ListenToggle listening={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: 'Listening: off' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows "Start listening" text when listening is false', () => {
    render(<ListenToggle listening={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Start listening')
  })

  it('shows "Stop listening" text when listening is true', () => {
    render(<ListenToggle listening={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Stop listening')
  })

  it('does not call onToggle before any click', () => {
    const onToggle = vi.fn()
    render(<ListenToggle listening={false} onToggle={onToggle} />)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
