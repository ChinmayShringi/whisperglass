import { describe, it, expect, vi } from 'vitest'
import { applyOverlayState } from '../../../src/main/windows/overlay-controller'

function fakeWindow() {
  return {
    setContentProtection: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    show: vi.fn(),
    hide: vi.fn()
  }
}

describe('applyOverlayState', () => {
  it('enables content protection when invisible is true', () => {
    const win = fakeWindow()
    applyOverlayState(win, { visible: true, invisible: true, clickThrough: false })
    expect(win.setContentProtection).toHaveBeenCalledWith(true)
  })

  it('forwards mouse events when click-through is true', () => {
    const win = fakeWindow()
    applyOverlayState(win, { visible: true, invisible: false, clickThrough: true })
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('shows the window when visible and hides it when not', () => {
    const shown = fakeWindow()
    applyOverlayState(shown, { visible: true, invisible: false, clickThrough: false })
    expect(shown.show).toHaveBeenCalled()

    const hidden = fakeWindow()
    applyOverlayState(hidden, { visible: false, invisible: false, clickThrough: false })
    expect(hidden.hide).toHaveBeenCalled()
  })

  it('disables content protection when invisible is false', () => {
    const win = fakeWindow()
    applyOverlayState(win, { visible: true, invisible: false, clickThrough: false })
    expect(win.setContentProtection).toHaveBeenCalledWith(false)
  })

  it('does not forward mouse events when click-through is false', () => {
    const win = fakeWindow()
    applyOverlayState(win, { visible: true, invisible: false, clickThrough: false })
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(false, { forward: true })
  })
})
