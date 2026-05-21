import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerChunk, AnswerResult, AnswerError } from '../../../shared/types'

export type CodexAnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface CodexAnswerState {
  status: CodexAnswerStatus
  question: string
  text: string
  error: string
}

export interface UseCodexAnswer {
  state: CodexAnswerState
  ask: (question: string) => void
  retry: () => void
}

const INITIAL: CodexAnswerState = { status: 'idle', question: '', text: '', error: '' }

export function useCodexAnswer(): UseCodexAnswer {
  const [state, setState] = useState<CodexAnswerState>(INITIAL)
  const requestIdRef = useRef('')
  const lastQuestionRef = useRef('')

  useEffect(() => {
    const offChunk = window.customcluely.onAnswerChunk((chunk: AnswerChunk) => {
      if (chunk.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'streaming', text: s.text + chunk.delta }))
    })
    const offDone = window.customcluely.onAnswerDone((result: AnswerResult) => {
      if (result.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'done', text: result.text }))
    })
    const offError = window.customcluely.onAnswerError((error: AnswerError) => {
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
    window.customcluely.askQuestion({ requestId, question: trimmed })
  }, [])

  const retry = useCallback(() => {
    if (lastQuestionRef.current.length > 0) ask(lastQuestionRef.current)
  }, [ask])

  return { state, ask, retry }
}
