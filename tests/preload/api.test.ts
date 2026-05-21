import { describe, it, expect, vi } from 'vitest'
import { createOverlayApi } from '../../src/preload/api'
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
