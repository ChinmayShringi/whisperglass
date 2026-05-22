// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnswerPanel } from '../../../src/renderer/src/components/AnswerPanel'

describe('AnswerPanel', () => {
  it('shows an empty state when the answer is blank', () => {
    render(<AnswerPanel answer="" />)
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('renders the answer text when present', () => {
    render(<AnswerPanel answer="the answer" />)
    expect(screen.getByText('the answer')).toBeInTheDocument()
  })

  it('shows the empty state when the answer is only whitespace', () => {
    render(<AnswerPanel answer="   " />)
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('does not show the empty state when an answer is present', () => {
    render(<AnswerPanel answer="the answer" />)
    expect(screen.queryByText('No answer yet')).not.toBeInTheDocument()
  })
})
