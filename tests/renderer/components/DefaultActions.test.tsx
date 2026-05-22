// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DefaultActions } from '../../../src/renderer/src/components/DefaultActions'

describe('DefaultActions', () => {
  it('renders a button for each of the five preset actions', () => {
    render(<DefaultActions onAction={vi.fn()} disabled={false} />)
    expect(screen.getByRole('button', { name: 'What should I say next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Follow-up questions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fact check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coding help (Smart Mode)' })).toBeInTheDocument()
  })

  it('calls onAction with the action id when a button is clicked', async () => {
    const onAction = vi.fn()
    render(<DefaultActions onAction={onAction} disabled={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    expect(onAction).toHaveBeenCalledWith('recap')
  })

  it('disables every button when disabled is true', () => {
    render(<DefaultActions onAction={vi.fn()} disabled={true} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('does not call onAction while disabled', async () => {
    const onAction = vi.fn()
    render(<DefaultActions onAction={onAction} disabled={true} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fact check' }))
    expect(onAction).not.toHaveBeenCalled()
  })
})
