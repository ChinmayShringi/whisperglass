import { describe, it, expect } from 'vitest'
import { buildOverlayWindowOptions } from '../../../src/main/windows/overlay-window-options'
import { OVERLAY } from '../../../src/main/config/constants'

describe('buildOverlayWindowOptions', () => {
  const opts = buildOverlayWindowOptions('/abs/preload/index.js')

  it('is transparent and frameless', () => {
    expect(opts.transparent).toBe(true)
    expect(opts.frame).toBe(false)
  })

  it('is always on top and hidden until shown', () => {
    expect(opts.alwaysOnTop).toBe(true)
    expect(opts.show).toBe(false)
  })

  it('is not resizable and skips the taskbar', () => {
    expect(opts.resizable).toBe(false)
    expect(opts.skipTaskbar).toBe(true)
  })

  it('uses the given preload path with context isolation on', () => {
    expect(opts.webPreferences?.preload).toBe('/abs/preload/index.js')
    expect(opts.webPreferences?.contextIsolation).toBe(true)
  })

  it('uses the OVERLAY constant dimensions', () => {
    expect(opts.width).toBe(720)
    expect(opts.height).toBe(480)
    expect(opts.width).toBe(OVERLAY.width)
    expect(opts.height).toBe(OVERLAY.height)
  })

  it('is movable', () => {
    expect(opts.movable).toBe(true)
  })

  it('is not minimizable, maximizable, or fullscreenable', () => {
    expect(opts.minimizable).toBe(false)
    expect(opts.maximizable).toBe(false)
    expect(opts.fullscreenable).toBe(false)
  })

  it('has no window shadow', () => {
    expect(opts.hasShadow).toBe(false)
  })

  it('disables the renderer sandbox for preload bridge access', () => {
    expect(opts.webPreferences?.sandbox).toBe(false)
  })
})
