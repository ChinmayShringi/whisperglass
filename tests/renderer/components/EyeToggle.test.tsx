// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EyeToggle } from '../../../src/renderer/src/components/EyeToggle'

describe('EyeToggle', () => {
  it('labels itself by the current invisibility state', () => {
    render(<EyeToggle invisible={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Invisible: on' })).toBeInTheDocument()
  })

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn()
    render(<EyeToggle invisible={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: 'Invisible: off' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows "Eye" text when invisible is false', () => {
    render(<EyeToggle invisible={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Eye')
  })

  it('shows "Eye off" text when invisible is true', () => {
    render(<EyeToggle invisible={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Eye off')
  })

  it('does not call onToggle before any click', () => {
    const onToggle = vi.fn()
    render(<EyeToggle invisible={false} onToggle={onToggle} />)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
