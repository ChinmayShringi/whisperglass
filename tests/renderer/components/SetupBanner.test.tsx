// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SetupBanner } from '../../../src/renderer/src/components/SetupBanner'

describe('SetupBanner', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<SetupBanner message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the message when present', () => {
    render(<SetupBanner message="Run codex login" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Run codex login')
  })

  it('renders the alert element for an empty-string message', () => {
    render(<SetupBanner message="" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders a different message inside the alert', () => {
    render(<SetupBanner message="Screen Recording permission needed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Screen Recording permission needed')
  })
})
