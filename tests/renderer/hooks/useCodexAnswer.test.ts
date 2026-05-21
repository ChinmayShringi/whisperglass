// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodexAnswer } from '../../../src/renderer/src/hooks/useCodexAnswer'
import type { AnswerChunk, AnswerResult, AnswerError } from '../../../src/shared/types'

type Cb<T> = (payload: T) => void

let chunkCb: Cb<AnswerChunk> = () => {}
let doneCb: Cb<AnswerResult> = () => {}
let errorCb: Cb<AnswerError> = () => {}
let lastRequest: { requestId: string; question: string } | null = null

beforeEach(() => {
  lastRequest = null
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion: vi.fn((req) => {
      lastRequest = req
    }),
    onAnswerChunk: vi.fn((cb: Cb<AnswerChunk>) => {
      chunkCb = cb
      return () => {}
    }),
    onAnswerDone: vi.fn((cb: Cb<AnswerResult>) => {
      doneCb = cb
      return () => {}
    }),
    onAnswerError: vi.fn((cb: Cb<AnswerError>) => {
      errorCb = cb
      return () => {}
    }),
    onCodexStatus: vi.fn(() => () => {}),
  }
})

describe('useCodexAnswer', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useCodexAnswer())
    expect(result.current.state.status).toBe('idle')
  })

  it('moves to streaming and records the question on ask', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('What is a closure?'))
    expect(result.current.state.status).toBe('streaming')
    expect(result.current.state.question).toBe('What is a closure?')
    expect(lastRequest?.question).toBe('What is a closure?')
  })

  it('appends chunks that match the active request id', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    const id = lastRequest!.requestId
    act(() => chunkCb({ requestId: id, delta: 'Hello' }))
    act(() => chunkCb({ requestId: id, delta: ' world' }))
    expect(result.current.state.text).toBe('Hello world')
  })

  it('ignores chunks for a stale request id', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    act(() => chunkCb({ requestId: 'stale', delta: 'nope' }))
    expect(result.current.state.text).toBe('')
  })

  it('replaces text and finishes on done', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    const id = lastRequest!.requestId
    act(() => doneCb({ requestId: id, text: 'final answer' }))
    expect(result.current.state.status).toBe('done')
    expect(result.current.state.text).toBe('final answer')
  })

  it('records the error on error', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    const id = lastRequest!.requestId
    act(() => errorCb({ requestId: id, message: 'it broke' }))
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toBe('it broke')
  })

  it('retry re-asks the last question', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('first question'))
    act(() => result.current.retry())
    expect(lastRequest?.question).toBe('first question')
    expect(result.current.state.status).toBe('streaming')
  })
})
