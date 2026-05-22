// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnswerPanel } from '../../../src/renderer/src/components/AnswerPanel'

describe('AnswerPanel', () => {
  it('shows the empty placeholder when idle with no text', () => {
    render(<AnswerPanel answer="" status="idle" />)
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('shows a thinking placeholder while streaming with no text yet', () => {
    render(<AnswerPanel answer="" status="streaming" />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('shows the streamed text once chunks arrive', () => {
    render(<AnswerPanel answer="partial answer" status="streaming" />)
    expect(screen.getByText('partial answer')).toBeInTheDocument()
  })

  it('shows the final answer when done', () => {
    render(<AnswerPanel answer="final answer" status="done" />)
    expect(screen.getByText('final answer')).toBeInTheDocument()
  })

  it('shows the error message and a retry button on error', async () => {
    const onRetry = vi.fn()
    render(<AnswerPanel answer="" status="error" error="codex failed" onRetry={onRetry} />)
    expect(screen.getByText('codex failed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
