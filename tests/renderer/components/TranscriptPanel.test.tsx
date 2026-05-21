// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptPanel } from '../../../src/renderer/src/components/TranscriptPanel'

describe('TranscriptPanel', () => {
  it('shows an empty state when there are no segments', () => {
    render(<TranscriptPanel segments={[]} />)
    expect(screen.getByText('No transcript yet')).toBeInTheDocument()
  })

  it('renders each segment with its speaker label', () => {
    render(<TranscriptPanel segments={[{ id: '1', speaker: 'them', text: 'hello there' }]} />)
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.getByText('them')).toBeInTheDocument()
  })

  it('renders the text of every segment when given multiple segments', () => {
    render(
      <TranscriptPanel
        segments={[
          { id: 'a', speaker: 'them', text: 'first line' },
          { id: 'b', speaker: 'you', text: 'second line' },
          { id: 'c', speaker: 'them', text: 'third line' }
        ]}
      />
    )
    expect(screen.getByText('first line')).toBeInTheDocument()
    expect(screen.getByText('second line')).toBeInTheDocument()
    expect(screen.getByText('third line')).toBeInTheDocument()
  })

  it('renders the you speaker label for a you segment', () => {
    render(<TranscriptPanel segments={[{ id: '1', speaker: 'you', text: 'my question' }]} />)
    expect(screen.getByText('you')).toBeInTheDocument()
  })

  it('does not show the empty state when segments are present', () => {
    render(<TranscriptPanel segments={[{ id: '1', speaker: 'them', text: 'hello there' }]} />)
    expect(screen.queryByText('No transcript yet')).not.toBeInTheDocument()
  })
})
