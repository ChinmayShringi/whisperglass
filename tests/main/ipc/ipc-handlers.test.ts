import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

function makeDeps() {
  return {
    onToggleInvisibility: vi.fn(),
    onAskQuestion: vi.fn(),
    onAskContextQuestion: vi.fn(),
    onStartTranscription: vi.fn(),
    onStopTranscription: vi.fn(),
    onRequestScreenshot: vi.fn()
  }
}

function makeIpc(): {
  ipcMain: { on: ReturnType<typeof vi.fn> }
  handlers: Record<string, (...args: unknown[]) => void>
} {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const ipcMain = {
    on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
      handlers[c] = l
    })
  }
  return { ipcMain, handlers }
}

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('forwards the request payload when the AskQuestion channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-1', question: 'hello' }
    handlers[IpcChannel.AskQuestion]({}, request)
    expect(deps.onAskQuestion).toHaveBeenCalledWith(request)
  })

  it('forwards the request payload when the AskContextQuestion channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-2', question: 'recap', segments: [], screenshot: false, extraArgs: [] }
    handlers[IpcChannel.AskContextQuestion]({}, request)
    expect(deps.onAskContextQuestion).toHaveBeenCalledWith(request)
  })

  it('calls onStartTranscription when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StartTranscription]()
    expect(deps.onStartTranscription).toHaveBeenCalledOnce()
  })

  it('calls onStopTranscription when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StopTranscription]()
    expect(deps.onStopTranscription).toHaveBeenCalledOnce()
  })

  it('calls onRequestScreenshot when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.RequestScreenshot]()
    expect(deps.onRequestScreenshot).toHaveBeenCalledOnce()
  })

  it('does not register the removed AudioFrame channel', () => {
    const { ipcMain, handlers } = makeIpc()
    registerIpcHandlers(ipcMain, makeDeps())
    expect(handlers['transcription:audio-frame']).toBeUndefined()
  })

  it('registers exactly six channel handlers', () => {
    const { ipcMain } = makeIpc()
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledTimes(6)
  })
})
