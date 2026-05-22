import { spawn, type ChildProcess } from 'node:child_process'
import { splitLines } from '../codex/line-splitter'
import { backoffDelayMs } from './backoff'
import {
  parseSidecarLine,
  encodeSidecarCommand,
  type SidecarEvent
} from './sidecar-protocol'
import type { SidecarStatusPayload, ScreenshotPayload } from '../../shared/types'

/** A decoded audio frame handed to the supervisor's audio callback. */
export interface SidecarAudioFrame {
  source: 'system' | 'mic'
  seq: number
  sampleRate: number
  pcm: string
}

/** A decoded permission report handed to the permission callback. */
export interface SidecarPermission {
  kind: 'screen' | 'mic'
  granted: boolean
}

export interface SidecarSupervisorDeps {
  /** The sidecar binary, or `node` in tests. */
  command: string
  /** Args inserted before any sidecar args (the mock script path in tests). */
  prefixArgs: string[]
  /** The app bundle id, sent on `start` so the sidecar excludes own windows. */
  appBundleId: string
  /** Backoff base delay in ms. */
  baseBackoffMs: number
  /** Backoff cap in ms. */
  maxBackoffMs: number
  /** A process up at least this long resets the backoff counter. */
  stableUptimeMs: number
  /** Called with every decoded audio frame. */
  onAudio: (frame: SidecarAudioFrame) => void
  /** Called with every decoded screenshot. */
  onScreenshot: (screenshot: ScreenshotPayload) => void
  /** Called with every supervisor or sidecar status change. */
  onStatus: (status: SidecarStatusPayload) => void
  /** Called with every decoded permission report. */
  onPermission: (permission: SidecarPermission) => void
}

export interface SidecarSupervisor {
  /** Spawns the sidecar and begins capture. Idempotent. */
  start: () => void
  /** Asks the running sidecar for one screenshot. No-op when not running. */
  requestScreenshot: () => void
  /** Stops capture and terminates the sidecar without restarting it. */
  shutdown: () => Promise<void>
}

// Spawns and supervises the Swift capture sidecar. It frames the child's
// stdout with the shared splitLines buffer, parses each line with the pure
// parseSidecarLine, and routes events to the injected callbacks. On an
// unexpected exit it emits a 'paused' status and respawns with exponential
// backoff; an intentional shutdown suppresses the restart. Mirrors the
// whisper-runner.ts error-handling shape (error handler bound before stdio).
export function createSidecarSupervisor(deps: SidecarSupervisorDeps): SidecarSupervisor {
  let child: ChildProcess | null = null
  let stdoutBuffer = ''
  let restartAttempt = 0
  let restartTimer: NodeJS.Timeout | null = null
  let stableTimer: NodeJS.Timeout | null = null
  let intentionalStop = false
  let started = false

  function routeEvent(event: SidecarEvent): void {
    switch (event.kind) {
      case 'audio':
        deps.onAudio({
          source: event.source,
          seq: event.seq,
          sampleRate: event.sampleRate,
          pcm: event.pcm
        })
        return
      case 'screenshot':
        deps.onScreenshot({ format: 'png', dataBase64: event.dataBase64 })
        return
      case 'status':
        deps.onStatus({ state: stateOf(event.state), detail: event.detail })
        return
      case 'permission':
        deps.onPermission({ kind: event.permissionKind, granted: event.granted })
        return
      case 'ignored':
        return
    }
  }

  // Narrows the sidecar's free-form status string to the IPC payload union.
  function stateOf(raw: string): SidecarStatusPayload['state'] {
    if (raw === 'capturing' || raw === 'stopped' || raw === 'error') return raw
    return 'error'
  }

  function clearTimers(): void {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (stableTimer) {
      clearTimeout(stableTimer)
      stableTimer = null
    }
  }

  function writeCommand(line: string): void {
    if (child && child.stdin && !child.stdin.destroyed) {
      child.stdin.write(line)
    }
  }

  function spawnChild(): void {
    stdoutBuffer = ''
    const proc = spawn(deps.command, [...deps.prefixArgs], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child = proc

    // Bind the error handler before touching stdio: on a spawn failure the
    // streams can be null and the failure arrives through this event.
    proc.on('error', (err: Error) => {
      deps.onStatus({ state: 'error', detail: `Sidecar failed to start: ${err.message}` })
      scheduleRestart()
    })

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        const split = splitLines(stdoutBuffer, chunk)
        stdoutBuffer = split.rest
        for (const line of split.lines) {
          routeEvent(parseSidecarLine(line))
        }
      })
    }

    // stderr is internal-only diagnostic detail; it is not surfaced, matching
    // the whisper-runner and codex-runner policy of never leaking raw stderr.
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', () => {})
    }

    proc.on('close', () => {
      child = null
      if (intentionalStop) return
      deps.onStatus({ state: 'paused', detail: 'Audio paused, reconnecting capture...' })
      scheduleRestart()
    })

    // A process that stays up past the stable threshold resets the backoff.
    stableTimer = setTimeout(() => {
      restartAttempt = 0
    }, deps.stableUptimeMs)

    // Begin capture immediately on every (re)spawn.
    writeCommand(
      encodeSidecarCommand({
        type: 'start',
        capture: ['systemAudio', 'mic'],
        appBundleId: deps.appBundleId
      })
    )
  }

  function scheduleRestart(): void {
    if (intentionalStop) return
    restartAttempt += 1
    const delay = backoffDelayMs(restartAttempt, deps.baseBackoffMs, deps.maxBackoffMs)
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!intentionalStop) spawnChild()
    }, delay)
  }

  function start(): void {
    if (started) return
    started = true
    intentionalStop = false
    spawnChild()
  }

  function requestScreenshot(): void {
    writeCommand(encodeSidecarCommand({ type: 'screenshot' }))
  }

  async function shutdown(): Promise<void> {
    intentionalStop = true
    clearTimers()
    const proc = child
    if (!proc) return
    writeCommand(encodeSidecarCommand({ type: 'shutdown' }))
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      proc.once('close', done)
      // If the sidecar does not exit promptly, force it.
      setTimeout(() => {
        if (!settled) proc.kill('SIGKILL')
        done()
      }, 1_000)
    })
    child = null
  }

  return { start, requestScreenshot, shutdown }
}
