// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'

beforeEach(() => {
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {})
  }
})

describe('App', () => {
  it('renders the command bar and both panels', () => {
    render(<App />)
    expect(screen.getByLabelText('Question input')).toBeInTheDocument()
    expect(screen.getByText('No transcript yet')).toBeInTheDocument()
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('calls the preload toggleInvisibility when the eye toggle is clicked', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Invisible: off' }))
    expect(window.customcluely.toggleInvisibility).toHaveBeenCalledOnce()
  })

  it('renders the eye toggle in the OFF state initially', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Invisible: off' })).toBeInTheDocument()
  })

  it('subscribes to overlay state on mount', () => {
    render(<App />)
    expect(window.customcluely.onOverlayState).toHaveBeenCalled()
  })

  it('shows the typed text as the active question after submitting', async () => {
    render(<App />)
    const question = 'What is the capital of France?'
    await userEvent.type(screen.getByLabelText('Question input'), question)
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByText(question)).toBeInTheDocument()
  })

  it('does not show an active question before any submit', () => {
    render(<App />)
    expect(screen.queryByText('What is the capital of France?')).not.toBeInTheDocument()
  })
})
