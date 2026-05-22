// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'
import type { ScreenshotPayload, TranscriptUpdatePayload } from '../../src/shared/types'

let askQuestion: ReturnType<typeof vi.fn>
let askContextQuestion: ReturnType<typeof vi.fn>
let requestScreenshot: ReturnType<typeof vi.fn>
let startTranscription: ReturnType<typeof vi.fn>
let transcriptUpdateCb: (p: TranscriptUpdatePayload) => void
let screenshotCb: (p: ScreenshotPayload) => void
let answerDoneCb: (r: { requestId: string; text: string }) => void

beforeEach(() => {
  askQuestion = vi.fn()
  askContextQuestion = vi.fn()
  requestScreenshot = vi.fn()
  startTranscription = vi.fn()
  transcriptUpdateCb = () => {}
  screenshotCb = () => {}
  window.whisperglass = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion,
    askContextQuestion,
    requestScreenshot,
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn((cb) => {
      answerDoneCb = cb
      return () => {}
    }),
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
    onScreenshot: vi.fn((cb) => {
      screenshotCb = cb
      return () => {}
    })
  }
})

afterEach(() => {
  vi.useRealTimers()
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

  // Auto-answer behavior: detected questions trigger askContextQuestion after
  // a short debounce so users do not have to press Tab during a live meeting.
  // Uses real timers and waitFor: the 1.5s debounce is short enough that the
  // test cost is tolerable, and fake timers interact poorly with userEvent.
  it('auto-answers a detected question after the debounce', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /listening: off/i }))
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    expect(askContextQuestion).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(askContextQuestion).toHaveBeenCalledOnce(), {
      timeout: 2500,
      interval: 100
    })
    const sent = askContextQuestion.mock.calls[0][0]
    expect(sent.question.toLowerCase()).toContain('when do we ship')
    expect(sent.screenshot).toBe(false)
  })

  it('does not auto-answer while the session is inactive', async () => {
    render(<App />)
    // Session never started, so even a question-shaped segment must not fire,
    // even after the full debounce window has elapsed.
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    await new Promise((r) => setTimeout(r, 1800))
    expect(askContextQuestion).not.toHaveBeenCalled()
  })

  it('auto-answers each new question id only once', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /listening: off/i }))
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    await vi.waitFor(() => expect(askContextQuestion).toHaveBeenCalledOnce(), {
      timeout: 2500,
      interval: 100
    })
    // Re-deliver the SAME segment id; must not fire a second time even after
    // another full debounce window.
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    await new Promise((r) => setTimeout(r, 1800))
    expect(askContextQuestion).toHaveBeenCalledOnce()
  })

  // Screenshot UX: the renderer shows a toast on capture and attaches the
  // pending shot to the next context-ask.
  it('shows a toast when a screenshot arrives', () => {
    render(<App />)
    act(() => {
      screenshotCb({ format: 'png', dataBase64: 'AAAA' })
    })
    expect(screen.getByText(/screenshot captured/i)).toBeInTheDocument()
  })

  it('passes screenshot:true to the next Default Action after a capture', async () => {
    render(<App />)
    act(() => {
      screenshotCb({ format: 'png', dataBase64: 'AAAA' })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    expect(askContextQuestion).toHaveBeenCalledOnce()
    const sent = askContextQuestion.mock.calls[0][0]
    expect(sent.screenshot).toBe(true)
  })

  it('clears the pending screenshot after one ask, so the next one is shot-free', async () => {
    render(<App />)
    act(() => {
      screenshotCb({ format: 'png', dataBase64: 'AAAA' })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    // Simulate the codex run completing so busy flips back to false and the
    // Default Action buttons re-enable for the second click.
    const firstRequestId = askContextQuestion.mock.calls[0][0].requestId
    act(() => {
      answerDoneCb({ requestId: firstRequestId, text: 'done' })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    expect(askContextQuestion).toHaveBeenCalledTimes(2)
    expect(askContextQuestion.mock.calls[0][0].screenshot).toBe(true)
    expect(askContextQuestion.mock.calls[1][0].screenshot).toBe(false)
  })
})
