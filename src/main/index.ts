import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createOverlayWindow } from './windows/overlay-window'
import {
  createOverlayState,
  toggleInvisible,
  toggleClickThrough,
  setVisible,
} from './windows/overlay-state'
import { applyOverlayState } from './windows/overlay-controller'
import { nextPosition } from './windows/position'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys/global-hotkeys'
import { registerIpcHandlers } from './ipc/ipc-handlers'
import { MOVE_STEP_PX } from './config/constants'
import { IpcChannel, type HotkeyAction } from '../shared/types'

let overlay: BrowserWindow | null = null
let state = createOverlayState()

function pushState(): void {
  if (!overlay) return
  applyOverlayState(overlay, state)
  overlay.webContents.send(IpcChannel.OverlayState, state)
}

function handleHotkey(action: HotkeyAction): void {
  if (!overlay) return
  switch (action) {
    case 'show-hide':
      state = setVisible(state, !state.visible)
      break
    case 'toggle-invisibility':
      state = toggleInvisible(state)
      break
    case 'toggle-click-through':
      state = toggleClickThrough(state)
      break
    case 'move-up':
    case 'move-down':
    case 'move-left':
    case 'move-right': {
      const pos = overlay.getPosition() as [number, number]
      const [x, y] = nextPosition(pos, action, MOVE_STEP_PX)
      overlay.setPosition(x, y)
      return
    }
  }
  pushState()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.customcluely.app')
  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  overlay = createOverlayWindow()
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  state = setVisible(state, true)
  overlay.on('ready-to-show', () => pushState())

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
  })

  registerGlobalHotkeys(globalShortcut, handleHotkey)
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
