import type { BrowserWindowConstructorOptions } from 'electron'
import { OVERLAY } from '../config/constants'

export function buildOverlayWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: OVERLAY.width,
    height: OVERLAY.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
    },
  }
}
