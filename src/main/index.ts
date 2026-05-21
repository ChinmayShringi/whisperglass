import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createOverlayWindow } from './windows/overlay-window'
import { createCodexService } from './codex/codex-service'
import { checkCodexAvailability } from './codex/availability'
import {
  createOverlayState,
  toggleInvisible,
  toggleClickThrough,
  setVisible
} from './windows/overlay-state'
import { applyOverlayState } from './windows/overlay-controller'
import { nextPosition } from './windows/position'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys/global-hotkeys'
import { registerIpcHandlers } from './ipc/ipc-handlers'
import { MOVE_STEP_PX, CODEX } from './config/constants'
import { IpcChannel, type HotkeyAction, type AskQuestionRequest } from '../shared/types'

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

function getCodexVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('codex', ['--version'], (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
}

function emitToOverlay(channel: string, payload: unknown): void {
  overlay?.webContents.send(channel, payload)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.customcluely.app')
  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  overlay = createOverlayWindow()
  overlay.on('ready-to-show', () => pushState())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  state = setVisible(state, true)

  const scratchRoot = join(app.getPath('userData'), CODEX.scratchDirName)
  const codexService = createCodexService({ scratchRoot, emit: emitToOverlay })

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request: AskQuestionRequest) => {
      void codexService.handleAsk(request)
    }
  })

  void checkCodexAvailability({
    getVersion: getCodexVersion,
    authFileExists: () => existsSync(join(homedir(), '.codex', 'auth.json'))
  }).then((status) => emitToOverlay(IpcChannel.CodexStatus, status))

  registerGlobalHotkeys(globalShortcut, handleHotkey)
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
