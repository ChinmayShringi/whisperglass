// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InsightList } from '../../../src/renderer/src/components/InsightList'
import type { Insight } from '../../../src/main/insights/insight-detector'

const insights: Insight[] = [
  { id: 'insight-1', kind: 'question', sourceSegmentId: '1', label: 'When do we ship?' },
  { id: 'insight-2', kind: 'keyword', sourceSegmentId: '2', label: 'the budget is tight' }
]

describe('InsightList', () => {
  it('renders nothing when there are no insights', () => {
    const { container } = render(<InsightList insights={[]} onAnswer={vi.fn()} disabled={false} />)
    expect(container.querySelector('.insight-list')).toBeNull()
  })

  it('renders one row per insight with its label', () => {
    render(<InsightList insights={insights} onAnswer={vi.fn()} disabled={false} />)
    expect(screen.getByText('When do we ship?')).toBeInTheDocument()
    expect(screen.getByText('the budget is tight')).toBeInTheDocument()
  })

  it('calls onAnswer with the insight when its row is clicked', async () => {
    const onAnswer = vi.fn()
    render(<InsightList insights={insights} onAnswer={onAnswer} disabled={false} />)
    await userEvent.click(screen.getByRole('button', { name: /When do we ship/ }))
    expect(onAnswer).toHaveBeenCalledWith(insights[0])
  })

  it('disables every insight button when disabled is true', () => {
    render(<InsightList insights={insights} onAnswer={vi.fn()} disabled={true} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })
})
