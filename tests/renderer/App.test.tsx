// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'
import type { TranscriptUpdatePayload } from '../../src/shared/types'

let askQuestion: ReturnType<typeof vi.fn>
let askContextQuestion: ReturnType<typeof vi.fn>
let requestScreenshot: ReturnType<typeof vi.fn>
let startTranscription: ReturnType<typeof vi.fn>
let transcriptUpdateCb: (p: TranscriptUpdatePayload) => void

beforeEach(() => {
  askQuestion = vi.fn()
  askContextQuestion = vi.fn()
  requestScreenshot = vi.fn()
  startTranscription = vi.fn()
  transcriptUpdateCb = () => {}
  window.whisperglass = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion,
    askContextQuestion,
    requestScreenshot,
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription,
    stopTranscription: vi.fn(),
    onTranscriptUpdate: vi.fn((cb) => {
      transcriptUpdateCb = cb
      return () => {}
    }),
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
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    expect(askQuestion).toHaveBeenCalledOnce()
    expect(screen.getByText('What is a closure?')).toBeInTheDocument()
  })

  it('renders the five Default Action buttons', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Recap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fact check' })).toBeInTheDocument()
  })

  it('clicking a Default Action sends a context-ask query', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    expect(askContextQuestion).toHaveBeenCalledOnce()
    const sent = askContextQuestion.mock.calls[0][0]
    expect(sent.question.toLowerCase()).toContain('recap')
  })

  it('the Fact check Default Action sends --search in extraArgs', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Fact check' }))
    const sent = askContextQuestion.mock.calls[0][0]
    expect(sent.extraArgs).toContain('--search')
  })

  it('clicking the screenshot button requests a screenshot from the sidecar', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /screenshot/i }))
    expect(requestScreenshot).toHaveBeenCalledOnce()
  })

  it('starting a session starts transcription and reveals detected insights', async () => {
    render(<App />)
    // ListenToggle exposes its accessible name via aria-label ("Listening: off"
    // / "Listening: on"), which overrides the visible "Start listening" text.
    await userEvent.click(screen.getByRole('button', { name: /listening: off/i }))
    expect(startTranscription).toHaveBeenCalledOnce()
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    // The detected question appears in the insight surface (the text also
    // appears in the transcript panel, so scope the assertion to the insight
    // list to confirm the insight specifically was revealed).
    const insightList = await screen.findByRole('button', { name: /when do we ship/i })
    expect(within(insightList).getByText('when do we ship?')).toBeInTheDocument()
  })

  it('does not show insights before a session is started', () => {
    render(<App />)
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    // The transcript panel still renders the line, but the insight surface does
    // not: only the transcript-panel copy of the text exists, not an insight button.
    expect(screen.queryByRole('button', { name: /question.*when do we ship/i })).toBeNull()
  })
})
