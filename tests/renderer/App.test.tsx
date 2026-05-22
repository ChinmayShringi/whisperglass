// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'
import type { TranscriptUpdatePayload, SidecarStatusPayload } from '../../src/shared/types'

let askQuestion: ReturnType<typeof vi.fn>

beforeEach(() => {
  askQuestion = vi.fn()
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion,
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    onTranscriptUpdate: vi.fn(() => () => {}),
    onTranscriptionStatus: vi.fn(() => () => {}),
    onSidecarStatus: vi.fn(() => () => {}),
    onScreenshot: vi.fn(() => () => {})
  }
})

describe('App', () => {
  it('renders the command bar and the empty answer panel', () => {
    render(<App />)
    expect(screen.getByLabelText('Question input')).toBeInTheDocument()
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('submitting a question calls askQuestion and shows the active question', async () => {
    render(<App />)
    const input = screen.getByLabelText('Question input')
    await userEvent.type(input, 'What is a closure?')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))
    expect(askQuestion).toHaveBeenCalledOnce()
    expect(askQuestion.mock.calls[0][0].question).toBe('What is a closure?')
    expect(screen.getByText('What is a closure?')).toBeInTheDocument()
  })

  it('subscribes to overlay state, answer events, and Codex status', () => {
    render(<App />)
    expect(window.customcluely.onOverlayState).toHaveBeenCalled()
    expect(window.customcluely.onAnswerChunk).toHaveBeenCalled()
    expect(window.customcluely.onCodexStatus).toHaveBeenCalled()
  })
})

describe('App live transcript and sidecar wiring', () => {
  let updateCb: (p: TranscriptUpdatePayload) => void = () => {}
  let sidecarCb: (p: SidecarStatusPayload) => void = () => {}

  beforeEach(() => {
    updateCb = () => {}
    sidecarCb = () => {}
    window.customcluely = {
      toggleInvisibility: vi.fn(),
      onOverlayState: vi.fn(() => () => {}),
      askQuestion: vi.fn(),
      onAnswerChunk: vi.fn(() => () => {}),
      onAnswerDone: vi.fn(() => () => {}),
      onAnswerError: vi.fn(() => () => {}),
      onCodexStatus: vi.fn(() => () => {}),
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      onTranscriptUpdate: vi.fn((cb: (p: TranscriptUpdatePayload) => void) => {
        updateCb = cb
        return () => {}
      }),
      onTranscriptionStatus: vi.fn(() => () => {}),
      onSidecarStatus: vi.fn((cb: (p: SidecarStatusPayload) => void) => {
        sidecarCb = cb
        return () => {}
      }),
      onScreenshot: vi.fn(() => () => {})
    }
  })

  it('renders a transcript segment pushed from the main process', () => {
    render(<App />)
    act(() => updateCb({ segments: [{ id: 's1', speaker: 'them', text: 'system audio line' }] }))
    expect(screen.getByText('system audio line')).toBeInTheDocument()
  })

  it('renders a Start listening control and does not auto-start listening', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Listening: off' })).toBeInTheDocument()
    expect(window.customcluely.startTranscription).not.toHaveBeenCalled()
  })

  it('shows an audio-paused banner when the sidecar reports a paused state', () => {
    render(<App />)
    act(() => sidecarCb({ state: 'paused', detail: 'Audio paused, reconnecting capture...' }))
    expect(screen.getByText('Audio paused, reconnecting capture...')).toBeInTheDocument()
  })

  it('does not show the audio-paused banner while the sidecar is capturing', () => {
    render(<App />)
    act(() => sidecarCb({ state: 'capturing', detail: 'ok' }))
    expect(screen.queryByText('Audio paused, reconnecting capture...')).not.toBeInTheDocument()
  })
})
