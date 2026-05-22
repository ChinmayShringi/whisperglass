import { describe, it, expect, vi } from 'vitest'
import {
  registerGlobalHotkeys,
  unregisterGlobalHotkeys
} from '../../../src/main/hotkeys/global-hotkeys'
import { GLOBAL_HOTKEYS } from '../../../src/main/config/constants'

describe('registerGlobalHotkeys', () => {
  it('registers every global hotkey', () => {
    const globalShortcut = { register: vi.fn(), unregisterAll: vi.fn() }
    registerGlobalHotkeys(globalShortcut, vi.fn())
    expect(globalShortcut.register).toHaveBeenCalledWith(
      'CommandOrControl+Shift+\\',
      expect.any(Function)
    )
  })

  it('invokes onAction with the resolved action when a shortcut fires', () => {
    const handlers: Record<string, () => void> = {}
    const globalShortcut = {
      register: vi.fn((accel: string, cb: () => void) => {
        handlers[accel] = cb
      }),
      unregisterAll: vi.fn()
    }
    const onAction = vi.fn()
    registerGlobalHotkeys(globalShortcut, onAction)
    handlers['CommandOrControl+Shift+\\']()
    expect(onAction).toHaveBeenCalledWith('toggle-invisibility')
  })

  it('calls register exactly once per GLOBAL_HOTKEYS entry', () => {
    const register = vi.fn()
    const globalShortcut = { register, unregisterAll: vi.fn() }
    registerGlobalHotkeys(globalShortcut, vi.fn())
    expect(register.mock.calls.length).toBe(Object.keys(GLOBAL_HOTKEYS).length)
  })

  it('invokes onAction with show-hide when CommandOrControl+\\ fires', () => {
    const handlers: Record<string, () => void> = {}
    const globalShortcut = {
      register: vi.fn((accel: string, cb: () => void) => {
        handlers[accel] = cb
      }),
      unregisterAll: vi.fn()
    }
    const onAction = vi.fn()
    registerGlobalHotkeys(globalShortcut, onAction)
    handlers['CommandOrControl+\\']()
    expect(onAction).toHaveBeenCalledWith('show-hide')
  })
})

describe('unregisterGlobalHotkeys', () => {
  it('calls unregisterAll', () => {
    const globalShortcut = { register: vi.fn(), unregisterAll: vi.fn() }
    unregisterGlobalHotkeys(globalShortcut)
    expect(globalShortcut.unregisterAll).toHaveBeenCalled()
  })
})
