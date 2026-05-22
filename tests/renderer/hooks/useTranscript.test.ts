// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTranscript } from '../../../src/renderer/src/hooks/useTranscript'
import type {
  TranscriptUpdatePayload,
  TranscriptionStatusPayload,
  SidecarStatusPayload
} from '../../../src/shared/types'

type Cb<T> = (payload: T) => void

let updateCb: Cb<TranscriptUpdatePayload> = () => {}
let statusCb: Cb<TranscriptionStatusPayload> = () => {}
let sidecarCb: Cb<SidecarStatusPayload> = () => {}
let started = 0
let stopped = 0

beforeEach(() => {
  updateCb = () => {}
  statusCb = () => {}
  sidecarCb = () => {}
  started = 0
  stopped = 0
  window.whisperglass = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion: vi.fn(),
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription: vi.fn(() => {
      started += 1
    }),
    stopTranscription: vi.fn(() => {
      stopped += 1
    }),
    onTranscriptUpdate: vi.fn((cb: Cb<TranscriptUpdatePayload>) => {
      updateCb = cb
      return () => {}
    }),
    onTranscriptionStatus: vi.fn((cb: Cb<TranscriptionStatusPayload>) => {
      statusCb = cb
      return () => {}
    }),
    onSidecarStatus: vi.fn((cb: Cb<SidecarStatusPayload>) => {
      sidecarCb = cb
      return () => {}
    }),
    onScreenshot: vi.fn(() => () => {})
  }
})

describe('useTranscript', () => {
  it('starts with no segments, not listening, not ready, and not paused', () => {
    const { result } = renderHook(() => useTranscript())
    expect(result.current.segments).toEqual([])
    expect(result.current.listening).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.audioPaused).toBe(false)
  })

  it('does not start transcription on mount', () => {
    renderHook(() => useTranscript())
    expect(started).toBe(0)
  })

  it('updates segments when a transcript update arrives', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => updateCb({ segments: [{ id: '1', speaker: 'them', text: 'hello' }] }))
    expect(result.current.segments).toEqual([{ id: '1', speaker: 'them', text: 'hello' }])
  })

  it('updates the ready flag when a transcription status arrives', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => statusCb({ ready: true, detail: 'ok' }))
    expect(result.current.ready).toBe(true)
  })

  it('exposes the status detail message', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => statusCb({ ready: false, detail: 'downloading model' }))
    expect(result.current.statusDetail).toBe('downloading model')
  })

  it('sets audioPaused true when the sidecar reports a paused state', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => sidecarCb({ state: 'paused', detail: 'reconnecting' }))
    expect(result.current.audioPaused).toBe(true)
  })

  it('clears audioPaused when the sidecar reports capturing again', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => sidecarCb({ state: 'paused', detail: 'reconnecting' }))
    act(() => sidecarCb({ state: 'capturing', detail: 'ok' }))
    expect(result.current.audioPaused).toBe(false)
  })

  it('startListening sets listening true and notifies the bridge only', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    expect(result.current.listening).toBe(true)
    expect(started).toBe(1)
  })

  it('stopListening sets listening false and notifies the bridge', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    act(() => result.current.stopListening())
    expect(result.current.listening).toBe(false)
    expect(stopped).toBe(1)
  })
})
