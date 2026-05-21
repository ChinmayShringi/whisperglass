import { describe, it, expect } from 'vitest'
import { resolveHotkeyAction } from '../../../src/main/hotkeys/hotkey-map'

describe('resolveHotkeyAction', () => {
  it('resolves a known accelerator to its action', () => {
    expect(resolveHotkeyAction('CommandOrControl+Shift+\\')).toBe('toggle-invisibility')
  })

  it('returns undefined for an unknown accelerator', () => {
    expect(resolveHotkeyAction('CommandOrControl+J')).toBeUndefined()
  })

  it('resolves CommandOrControl+\\ to show-hide', () => {
    expect(resolveHotkeyAction('CommandOrControl+\\')).toBe('show-hide')
  })

  it('resolves CommandOrControl+Shift+M to toggle-click-through', () => {
    expect(resolveHotkeyAction('CommandOrControl+Shift+M')).toBe('toggle-click-through')
  })

  it('resolves CommandOrControl+Up to move-up', () => {
    expect(resolveHotkeyAction('CommandOrControl+Up')).toBe('move-up')
  })

  it('returns undefined for an empty string', () => {
    expect(resolveHotkeyAction('')).toBeUndefined()
  })
})
