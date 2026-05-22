import { describe, it, expect, vi } from 'vitest'
import { createOverlayApi, type IpcRendererLike } from '../../src/preload/api'
import { IpcChannel } from '../../src/shared/types'

describe('createOverlayApi', () => {
  it('sends toggle-invisibility on the right channel', () => {
    const ipcRenderer = { send: vi.fn(), on: vi.fn() }
    createOverlayApi(ipcRenderer).toggleInvisibility()
    expect(ipcRenderer.send).toHaveBeenCalledWith(IpcChannel.ToggleInvisibility)
  })

  it('subscribes to overlay state and returns an unsubscribe function', () => {
    const listeners: Array<(...a: unknown[]) => void> = []
    const ipcRenderer = {
      send: vi.fn(),
      on: vi.fn((_c: string, l: (...a: unknown[]) => void) => listeners.push(l)),
      removeListener: vi.fn()
    }
    const cb = vi.fn()
    const unsub = createOverlayApi(ipcRenderer).onOverlayState(cb)
    listeners[0]({}, { visible: true, invisible: true, clickThrough: false })
    expect(cb).toHaveBeenCalledWith({ visible: true, invisible: true, clickThrough: false })
    unsub()
    expect(ipcRenderer.removeListener).toHaveBeenCalled()
  })

  it('registers onOverlayState on the OverlayState channel', () => {
    const ipcRenderer = { send: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
    createOverlayApi(ipcRenderer).onOverlayState(vi.fn())
    expect(ipcRenderer.on).toHaveBeenCalledWith(IpcChannel.OverlayState, expect.any(Function))
  })

  it('unsubscribe removes the same channel and listener passed to on', () => {
    const ipcRenderer = { send: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
    const unsub = createOverlayApi(ipcRenderer).onOverlayState(vi.fn())
    const [onChannel, onListener] = ipcRenderer.on.mock.calls[0]
    unsub()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(onChannel, onListener)
  })

  it('toggleInvisibility calls send exactly once', () => {
    const ipcRenderer = { send: vi.fn(), on: vi.fn() }
    createOverlayApi(ipcRenderer).toggleInvisibility()
    expect(ipcRenderer.send).toHaveBeenCalledOnce()
  })

  it('askQuestion sends the request on the AskQuestion channel', () => {
    const send = vi.fn()
    const api = createOverlayApi({ send, on: vi.fn(), removeListener: vi.fn() })
    const request = { requestId: 'r-1', question: 'hello' }
    api.askQuestion(request)
    expect(send).toHaveBeenCalledWith(IpcChannel.AskQuestion, request)
  })

  it('onAnswerChunk delivers the payload from the AnswerChunk channel', () => {
    const listeners: Record<string, (e: unknown, p: unknown) => void> = {}
    const api = createOverlayApi({
      send: vi.fn(),
      on: vi.fn((c: string, l: (e: unknown, p: unknown) => void) => {
        listeners[c] = l
      }),
      removeListener: vi.fn()
    })
    const received: unknown[] = []
    api.onAnswerChunk((chunk) => received.push(chunk))
    listeners[IpcChannel.AnswerChunk]({}, { requestId: 'r-1', delta: 'hi' })
    expect(received).toEqual([{ requestId: 'r-1', delta: 'hi' }])
  })

  it('onCodexStatus subscribes to the CodexStatus channel and unsubscribes', () => {
    const removeListener = vi.fn()
    const api = createOverlayApi({ send: vi.fn(), on: vi.fn(), removeListener })
    const unsubscribe = api.onCodexStatus(() => {})
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(IpcChannel.CodexStatus, expect.any(Function))
  })
})

describe('createOverlayApi transcription methods', () => {
  function makeIpc(): IpcRendererLike & {
    sent: { channel: string; args: unknown[] }[]
    listeners: Record<string, (e: unknown, p: unknown) => void>
  } {
    const sent: { channel: string; args: unknown[] }[] = []
    const listeners: Record<string, (e: unknown, p: unknown) => void> = {}
    return {
      sent,
      listeners,
      send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
      on: (channel: string, listener: (...a: unknown[]) => void) => {
        listeners[channel] = listener as (e: unknown, p: unknown) => void
      },
      removeListener: () => {}
    }
  }

  it('startTranscription sends on the StartTranscription channel', () => {
    const ipc = makeIpc()
    createOverlayApi(ipc).startTranscription()
    expect(ipc.sent[0].channel).toBe(IpcChannel.StartTranscription)
  })

  it('stopTranscription sends on the StopTranscription channel', () => {
    const ipc = makeIpc()
    createOverlayApi(ipc).stopTranscription()
    expect(ipc.sent[0].channel).toBe(IpcChannel.StopTranscription)
  })

  it('sendAudioFrame sends the frame payload on the AudioFrame channel', () => {
    const ipc = makeIpc()
    createOverlayApi(ipc).sendAudioFrame({ pcmBase64: 'AAAA' })
    expect(ipc.sent[0].channel).toBe(IpcChannel.AudioFrame)
    expect(ipc.sent[0].args[0]).toEqual({ pcmBase64: 'AAAA' })
  })

  it('onTranscriptUpdate subscribes to the TranscriptUpdate channel', () => {
    const ipc = makeIpc()
    const received: unknown[] = []
    createOverlayApi(ipc).onTranscriptUpdate((payload) => received.push(payload))
    ipc.listeners[IpcChannel.TranscriptUpdate]({}, { segments: [] })
    expect(received).toEqual([{ segments: [] }])
  })

  it('onTranscriptionStatus subscribes to the TranscriptionStatus channel', () => {
    const ipc = makeIpc()
    const received: unknown[] = []
    createOverlayApi(ipc).onTranscriptionStatus((payload) => received.push(payload))
    ipc.listeners[IpcChannel.TranscriptionStatus]({}, { ready: true, detail: 'ok' })
    expect(received).toEqual([{ ready: true, detail: 'ok' }])
  })
})
