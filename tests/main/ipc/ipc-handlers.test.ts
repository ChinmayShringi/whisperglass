import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const handlers: Record<string, () => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: () => void) => {
        handlers[c] = l
      })
    }
    const deps = { onToggleInvisibility: vi.fn() }
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('registers a handler on the ToggleInvisibility channel', () => {
    const ipcMain = { on: vi.fn() }
    registerIpcHandlers(ipcMain, { onToggleInvisibility: vi.fn() })
    expect(ipcMain.on).toHaveBeenCalledWith(IpcChannel.ToggleInvisibility, expect.any(Function))
  })

  it('registers exactly one channel handler', () => {
    const ipcMain = { on: vi.fn() }
    registerIpcHandlers(ipcMain, { onToggleInvisibility: vi.fn() })
    expect(ipcMain.on).toHaveBeenCalledOnce()
  })
})
