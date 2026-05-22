import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, statSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createOverlayWindow } from './windows/overlay-window'
import { createCodexService } from './codex/codex-service'
import { checkCodexAvailability } from './codex/availability'
import { resolveCodexPath } from './codex/resolve-codex-path'
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
import { resolveWhisperPaths } from './transcription/resolve-whisper-paths'
import { downloadModel, type HttpResponse } from './transcription/model-downloader'
import { createTranscriptionService } from './transcription/transcription-service'
import { runWhisper } from './transcription/whisper-runner'
import { MOVE_STEP_PX, CODEX, WHISPER } from './config/constants'
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

// Resolves `codex` via the `which` binary at its fixed absolute location.
function runWhich(): string | null {
  try {
    const found = execFileSync('/usr/bin/which', ['codex']).toString().trim()
    return found.length > 0 ? found : null
  } catch {
    return null
  }
}

function getCodexVersion(codexPath: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    if (codexPath === null) {
      resolve(null)
      return
    }
    execFile(codexPath, ['--version'], (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
}

function emitToOverlay(channel: string, payload: unknown): void {
  overlay?.webContents.send(channel, payload)
}

// Fetches the model over HTTPS and adapts the response to the downloader's
// injected HttpResponse shape. This is the only network call in Phase 3.
async function fetchModelHttp(url: string): Promise<HttpResponse> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  const lengthHeader = response.headers.get('content-length')
  return {
    totalBytes: lengthHeader ? Number(lengthHeader) : null,
    body: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  }
}

// Writes downloaded chunks to disk via a stream.
function writeModelStream(path: string, chunks: Buffer[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(path)
    out.on('error', reject)
    out.on('finish', resolve)
    for (const chunk of chunks) out.write(chunk)
    out.end()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.customcluely.app')
  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  const codexPath = resolveCodexPath({ fileExists: existsSync, runWhich })

  overlay = createOverlayWindow()
  overlay.on('ready-to-show', () => pushState())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  state = setVisible(state, true)

  const scratchRoot = join(app.getPath('userData'), CODEX.scratchDirName)
  const codexService = createCodexService({
    scratchRoot,
    emit: emitToOverlay,
    command: codexPath ?? undefined
  })

  // Resolve the bundled whisper assets. In a packaged app the resources live
  // under process.resourcesPath; in dev they live under the repo `resources`.
  const resourcesRoot = is.dev ? join(app.getAppPath(), 'resources') : process.resourcesPath
  const whisperPaths = resolveWhisperPaths({ resourcesRoot, fileExists: existsSync })

  const transcriptionService = createTranscriptionService({
    emit: emitToOverlay,
    runWhisper,
    modelPath: whisperPaths.modelPath,
    command: whisperPaths.binaryPath
  })

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request) => {
      void codexService.handleAsk(request)
    },
    // Starting a listening session resets the rolling audio state so the new
    // session never inherits stale PCM or transcript text from a prior one.
    onStartTranscription: () => {
      transcriptionService.reset()
    },
    // Stopping likewise clears the accumulator and rolling state. After this,
    // the renderer has released the microphone and sends no further frames.
    onStopTranscription: () => {
      transcriptionService.reset()
    },
    onAudioFrame: (frame) => {
      void transcriptionService.handleAudioFrame(frame)
    }
  })

  void checkCodexAvailability({
    getVersion: () => getCodexVersion(codexPath),
    authFileExists: () => existsSync(join(homedir(), '.codex', 'auth.json'))
  }).then((status) => emitToOverlay(IpcChannel.CodexStatus, status))

  // Download the whisper model on first run, then report readiness. The
  // binary must already be present (built by scripts/setup-whisper.sh).
  if (!whisperPaths.binaryPresent) {
    emitToOverlay(IpcChannel.TranscriptionStatus, {
      ready: false,
      detail: 'whisper-cli is missing. Run scripts/setup-whisper.sh.'
    })
  } else {
    emitToOverlay(IpcChannel.TranscriptionStatus, {
      ready: false,
      detail: 'Preparing the on-device transcription model...'
    })
    void downloadModel({
      modelPath: whisperPaths.modelPath,
      url: WHISPER.modelUrl,
      expectedBytes: WHISPER.modelByteSize,
      fileExists: existsSync,
      fileSize: (p) => statSync(p).size,
      fetchHttp: fetchModelHttp,
      writeStream: writeModelStream,
      onProgress: (fraction) => {
        emitToOverlay(IpcChannel.TranscriptionStatus, {
          ready: false,
          detail: `Downloading transcription model: ${Math.round(fraction * 100)}%`
        })
      }
    }).then((result) => {
      emitToOverlay(IpcChannel.TranscriptionStatus, {
        ready: result.ok,
        detail: result.ok ? 'On-device transcription ready.' : result.error
      })
    })
  }

  registerGlobalHotkeys(globalShortcut, handleHotkey)
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
