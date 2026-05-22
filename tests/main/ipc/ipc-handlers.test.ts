import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

function makeDeps() {
  return {
    onToggleInvisibility: vi.fn(),
    onAskQuestion: vi.fn(),
    onStartTranscription: vi.fn(),
    onStopTranscription: vi.fn(),
    onAudioFrame: vi.fn()
  }
}

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('forwards the request payload when the AskQuestion channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-1', question: 'hello' }
    handlers[IpcChannel.AskQuestion]({}, request)
    expect(deps.onAskQuestion).toHaveBeenCalledWith(request)
  })

  it('calls onStartTranscription when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StartTranscription]()
    expect(deps.onStartTranscription).toHaveBeenCalledOnce()
  })

  it('calls onStopTranscription when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StopTranscription]()
    expect(deps.onStopTranscription).toHaveBeenCalledOnce()
  })

  it('forwards the audio frame payload when the AudioFrame channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const frame = { pcmBase64: 'AAAA' }
    handlers[IpcChannel.AudioFrame]({}, frame)
    expect(deps.onAudioFrame).toHaveBeenCalledWith(frame)
  })

  it('registers exactly five channel handlers', () => {
    const ipcMain = { on: vi.fn() }
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledTimes(5)
  })
})
