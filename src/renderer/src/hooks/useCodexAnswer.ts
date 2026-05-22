import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnswerChunk,
  AnswerResult,
  AnswerError,
  TranscriptSegment
} from '../../../shared/types'

export type CodexAnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface CodexAnswerState {
  status: CodexAnswerStatus
  question: string
  text: string
  error: string
}

/** Options for a transcript-and-screenshot-aware context query. */
export interface AskContextOptions {
  /** Attach the pending screenshot to the query. */
  screenshot: boolean
  /** Extra codex flags, for example `['--search']` for Fact check. */
  extraArgs: string[]
}

export interface UseCodexAnswer {
  state: CodexAnswerState
  /** Sends a plain question with no transcript or screenshot context. */
  ask: (question: string) => void
  /** Sends a question grounded in the transcript, optionally with a shot. */
  askContext: (question: string, segments: TranscriptSegment[], options: AskContextOptions) => void
  retry: () => void
}

const INITIAL: CodexAnswerState = { status: 'idle', question: '', text: '', error: '' }

export function useCodexAnswer(): UseCodexAnswer {
  const [state, setState] = useState<CodexAnswerState>(INITIAL)
  const requestIdRef = useRef('')
  const lastQuestionRef = useRef('')

  useEffect(() => {
    const offChunk = window.whisperglass.onAnswerChunk((chunk: AnswerChunk) => {
      if (chunk.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'streaming', text: s.text + chunk.delta }))
    })
    const offDone = window.whisperglass.onAnswerDone((result: AnswerResult) => {
      if (result.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'done', text: result.text }))
    })
    const offError = window.whisperglass.onAnswerError((error: AnswerError) => {
      if (error.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'error', error: error.message }))
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  const ask = useCallback((question: string) => {
    const trimmed = question.trim()
    if (trimmed.length === 0) return
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    lastQuestionRef.current = trimmed
    setState({ status: 'streaming', question: trimmed, text: '', error: '' })
    window.whisperglass.askQuestion({ requestId, question: trimmed })
  }, [])

  const askContext = useCallback(
    (question: string, segments: TranscriptSegment[], options: AskContextOptions) => {
      const trimmed = question.trim()
      if (trimmed.length === 0) return
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      lastQuestionRef.current = trimmed
      setState({ status: 'streaming', question: trimmed, text: '', error: '' })
      window.whisperglass.askContextQuestion({
        requestId,
        question: trimmed,
        segments,
        screenshot: options.screenshot,
        extraArgs: options.extraArgs
      })
    },
    []
  )

  const retry = useCallback(() => {
    if (lastQuestionRef.current.length > 0) ask(lastQuestionRef.current)
  }, [ask])

  return { state, ask, askContext, retry }
}
