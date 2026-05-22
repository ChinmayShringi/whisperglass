import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { OVERLAY } from '../config/constants'
import { buildOverlayWindowOptions } from './overlay-window-options'

export function createOverlayWindow(): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.js')
  const win = new BrowserWindow(buildOverlayWindowOptions(preloadPath))
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
  win.setPosition(Math.round((screenWidth - OVERLAY.width) / 2), OVERLAY.marginTop)
  return win
}
