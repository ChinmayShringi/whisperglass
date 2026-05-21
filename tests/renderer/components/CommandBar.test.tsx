// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../../../src/renderer/src/components/CommandBar'

describe('CommandBar', () => {
  it('submits trimmed text when the Ask button is clicked', async () => {
    const onSubmit = vi.fn()
    render(<CommandBar onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Question input'), '  hello  ')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(onSubmit).toHaveBeenCalledWith('hello')
  })

  it('does not submit when the input is empty', async () => {
    const onSubmit = vi.fn()
    render(<CommandBar onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears the input after a submit', async () => {
    render(<CommandBar onSubmit={vi.fn()} />)
    const input = screen.getByLabelText('Question input') as HTMLInputElement
    await userEvent.type(input, 'question')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(input.value).toBe('')
  })

  it('submits the trimmed value when Cmd+Enter is pressed', async () => {
    const onSubmit = vi.fn()
    render(<CommandBar onSubmit={onSubmit} />)
    const input = screen.getByLabelText('Question input')
    await userEvent.type(input, '  meta submit  ')
    await userEvent.type(input, '{Meta>}{Enter}{/Meta}')
    expect(onSubmit).toHaveBeenCalledWith('meta submit')
  })

  it('submits the trimmed value when Ctrl+Enter is pressed', async () => {
    const onSubmit = vi.fn()
    render(<CommandBar onSubmit={onSubmit} />)
    const input = screen.getByLabelText('Question input')
    await userEvent.type(input, '  ctrl submit  ')
    await userEvent.type(input, '{Control>}{Enter}{/Control}')
    expect(onSubmit).toHaveBeenCalledWith('ctrl submit')
  })

  it('disables the input and the Ask button when disabled is true', () => {
    render(<CommandBar onSubmit={vi.fn()} disabled />)
    const input = screen.getByLabelText('Question input') as HTMLInputElement
    const button = screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement
    expect(input.disabled).toBe(true)
    expect(button.disabled).toBe(true)
  })

  it('shows the placeholder text when disabled is true', () => {
    render(<CommandBar onSubmit={vi.fn()} disabled />)
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument()
  })
})
