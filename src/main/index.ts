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
import { resolveSidecarPath } from './transcription/resolve-sidecar-path'
import { downloadModel, type HttpResponse } from './transcription/model-downloader'
import { createTranscriptionService } from './transcription/transcription-service'
import { runWhisper } from './transcription/whisper-runner'
import { createSidecarSupervisor } from './sidecar/sidecar-supervisor'
import { createScreenshotStore } from './screenshots/screenshot-store'
import { writeFile as fsWriteFile, mkdir as fsMkdir, rm as fsRm } from 'node:fs/promises'
import { MOVE_STEP_PX, CODEX, WHISPER, SIDECAR } from './config/constants'
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
// injected HttpResponse shape. This is the only network call in the app.
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
  electronApp.setAppUserModelId(SIDECAR.appBundleId)
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

  // Resolve the bundled native assets. In a packaged app the resources live
  // under process.resourcesPath; in dev they live under the repo `resources`.
  const resourcesRoot = is.dev ? join(app.getAppPath(), 'resources') : process.resourcesPath
  const whisperPaths = resolveWhisperPaths({ resourcesRoot, fileExists: existsSync })
  const sidecarPaths = resolveSidecarPath({ resourcesRoot, fileExists: existsSync })

  const transcriptionService = createTranscriptionService({
    emit: emitToOverlay,
    runWhisper,
    modelPath: whisperPaths.modelPath,
    command: whisperPaths.binaryPath
  })

  // The Swift capture sidecar: it captures system audio and the microphone,
  // takes screenshots, and is supervised with restart-on-crash. Its audio
  // frames are routed straight into the transcription service with the
  // matching capture source so the speaker hint is correct.
  const sidecar = createSidecarSupervisor({
    command: sidecarPaths.binaryPath,
    prefixArgs: [],
    appBundleId: SIDECAR.appBundleId,
    baseBackoffMs: SIDECAR.baseBackoffMs,
    maxBackoffMs: SIDECAR.maxBackoffMs,
    stableUptimeMs: SIDECAR.stableUptimeMs,
    onAudio: (frame) => {
      void transcriptionService.handleAudioFrame({ pcmBase64: frame.pcm }, frame.source)
    },
    onScreenshot: (screenshot) => {
      void screenshotStore.save(screenshot)
      emitToOverlay(IpcChannel.Screenshot, screenshot)
    },
    onStatus: (status) => emitToOverlay(IpcChannel.SidecarStatus, status),
    onPermission: (permission) => {
      // A denied permission is surfaced through the sidecar status channel so
      // the renderer can show a banner that deep-links to System Settings.
      if (!permission.granted) {
        const pane = permission.kind === 'screen' ? 'Screen Recording' : 'Microphone'
        emitToOverlay(IpcChannel.SidecarStatus, {
          state: 'error',
          detail: `${pane} permission is denied. Grant it to Customcluely in System Settings > Privacy & Security > ${pane}.`
        })
      }
    }
  })

  // Holds the single pending screenshot for the next Codex query. Screenshots
  // are written as PNG files into the Codex scratch dir so the runner can
  // attach them with `-i`; they are deleted once a query consumes them.
  const screenshotStore = createScreenshotStore({
    scratchRoot,
    writeFile: async (path, data) => {
      await fsMkdir(join(scratchRoot, 'screenshots'), { recursive: true })
      await fsWriteFile(path, data)
    },
    deleteFile: (path) => fsRm(path, { force: true })
  })

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request) => {
      void codexService.handleAsk(request)
    },
    // A transcript-and-screenshot-aware query. The pending screenshot (if any)
    // is consumed here so it is attached to exactly one query.
    onAskContextQuestion: (request) => {
      void screenshotStore.consume().then((screenshotPath) => {
        void codexService.handleContextAsk(request, screenshotPath)
      })
    },
    // Starting a listening session resets the rolling audio state and starts
    // the Swift sidecar capturing system audio and the microphone.
    onStartTranscription: () => {
      transcriptionService.reset()
      sidecar.start()
    },
    // Stopping clears the rolling state. The sidecar keeps running so a
    // restart is fast; it is fully shut down only on app quit.
    onStopTranscription: () => {
      transcriptionService.reset()
    },
    // The renderer asked for a screenshot: forward the request to the sidecar.
    // The sidecar's screenshot event lands in screenshotStore via onScreenshot.
    onRequestScreenshot: () => {
      sidecar.requestScreenshot()
    }
  })

  void checkCodexAvailability({
    getVersion: () => getCodexVersion(codexPath),
    authFileExists: () => existsSync(join(homedir(), '.codex', 'auth.json'))
  }).then((status) => emitToOverlay(IpcChannel.CodexStatus, status))

  // Report sidecar availability so the renderer can warn if the binary is
  // missing (it must be built by scripts/setup-sidecar.sh).
  if (!sidecarPaths.binaryPresent) {
    emitToOverlay(IpcChannel.SidecarStatus, {
      state: 'error',
      detail: 'The capture sidecar is missing. Run scripts/setup-sidecar.sh.'
    })
  }

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

  // Shut the sidecar down cleanly before the app exits.
  app.on('will-quit', () => {
    void sidecar.shutdown()
  })
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
