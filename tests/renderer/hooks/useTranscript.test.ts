// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTranscript } from '../../../src/renderer/src/hooks/useTranscript'
import type { TranscriptUpdatePayload, TranscriptionStatusPayload } from '../../../src/shared/types'

type Cb<T> = (payload: T) => void

let updateCb: Cb<TranscriptUpdatePayload> = () => {}
let statusCb: Cb<TranscriptionStatusPayload> = () => {}
let started = 0
let stopped = 0
let getUserMediaCalls = 0
let trackStops = 0

// A fake MediaStream whose tracks count their stop() calls, so a test can
// confirm stopListening releases the microphone.
function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: () => { trackStops += 1 } }]
  } as unknown as MediaStream
}

beforeEach(() => {
  updateCb = () => {}
  statusCb = () => {}
  started = 0
  stopped = 0
  getUserMediaCalls = 0
  trackStops = 0
  window.customcluely = {
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
    sendAudioFrame: vi.fn(),
    onTranscriptUpdate: vi.fn((cb: Cb<TranscriptUpdatePayload>) => {
      updateCb = cb
      return () => {}
    }),
    onTranscriptionStatus: vi.fn((cb: Cb<TranscriptionStatusPayload>) => {
      statusCb = cb
      return () => {}
    })
  }
  // The AudioContext and AudioWorklet APIs are not implemented in jsdom, so
  // they are stubbed here. getUserMedia is counted to prove it is NOT called
  // on mount and IS called only on startListening.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        getUserMediaCalls += 1
        return fakeStream()
      })
    }
  })
  class FakeAudioContext {
    sampleRate = 48_000
    destination = {}
    audioWorklet = { addModule: vi.fn(async () => {}) }
    createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
      return { connect: () => {}, disconnect: () => {} }
    }
    close(): Promise<void> {
      return Promise.resolve()
    }
  }
  class FakeAudioWorkletNode {
    port: { onmessage: unknown } = { onmessage: null }
    connect(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  vi.stubGlobal('Blob', class {})
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
})

describe('useTranscript', () => {
  it('starts with no segments, not listening, and a not-ready status', () => {
    const { result } = renderHook(() => useTranscript())
    expect(result.current.segments).toEqual([])
    expect(result.current.listening).toBe(false)
    expect(result.current.ready).toBe(false)
  })

  it('does not call getUserMedia on mount', () => {
    renderHook(() => useTranscript())
    expect(getUserMediaCalls).toBe(0)
  })

  it('updates segments when a transcript update arrives', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => updateCb({ segments: [{ id: '1', speaker: 'you', text: 'hello' }] }))
    expect(result.current.segments).toEqual([{ id: '1', speaker: 'you', text: 'hello' }])
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

  it('startListening sets listening true, notifies the bridge, and calls getUserMedia', async () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    expect(result.current.listening).toBe(true)
    expect(started).toBe(1)
    await waitFor(() => expect(getUserMediaCalls).toBe(1))
  })

  it('stopListening sets listening false, notifies the bridge, and releases the mic tracks', async () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    await waitFor(() => expect(getUserMediaCalls).toBe(1))
    await act(async () => {
      result.current.stopListening()
    })
    expect(result.current.listening).toBe(false)
    expect(stopped).toBe(1)
    await waitFor(() => expect(trackStops).toBe(1))
  })
})
