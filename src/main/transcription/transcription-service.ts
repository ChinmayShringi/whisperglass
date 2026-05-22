import { join } from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { WHISPER } from '../config/constants'
import { IpcChannel } from '../../shared/types'
import { createPcmAccumulator, pushPcm, type PcmAccumulatorState } from './pcm-accumulator'
import {
  createTranscriptBuffer,
  appendSegment,
  readSegments,
  type TranscriptBuffer
} from './transcript-buffer'
import { encodeWav } from './wav-encoder'
import { dedupOverlap } from './overlap-dedup'
import type { RunWhisperResult } from './whisper-runner'

// 16-bit mono PCM is 2 bytes per sample. Window and overlap byte sizes are
// derived once from the WHISPER timing constants.
const BYTES_PER_SECOND = WHISPER.sampleRate * 2
const WINDOW_BYTES = WHISPER.windowSeconds * BYTES_PER_SECOND
const OVERLAP_BYTES = WHISPER.overlapSeconds * BYTES_PER_SECOND

export interface TranscriptionServiceDeps {
  /** Sends an IPC payload to the renderer. */
  emit: (channel: string, payload: unknown) => void
  /** Runs whisper-cli on one WAV window. Injected for testing. */
  runWhisper: (input: {
    command: string
    prefixArgs: string[]
    modelPath: string
    wavPath: string
    timeoutMs: number
  }) => Promise<RunWhisperResult>
  /** Absolute path to the ggml model file. */
  modelPath: string
  /** The whisper-cli binary path; defaults to WHISPER.binaryName. */
  command?: string
}

export interface TranscriptionService {
  /** Accepts one PCM frame from the renderer. */
  handleAudioFrame: (payload: unknown) => Promise<void>
  /** Clears all transcript state, for a new session. */
  reset: () => void
}

function pcmOf(payload: unknown): Buffer | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).pcmBase64
    if (typeof value === 'string' && value.length > 0) {
      return Buffer.from(value, 'base64')
    }
  }
  return null
}

// Orchestrates microphone transcription. It accumulates PCM frames into
// rolling 8 s windows (2 s overlap), runs whisper on each completed window,
// de-duplicates the overlap against the previous window's text, appends the
// new text to the immutable transcript buffer, and emits the full transcript
// to the renderer. Mirrors codex-service.ts: a single-flight guard ensures
// only one whisper subprocess runs at a time.
export function createTranscriptionService(deps: TranscriptionServiceDeps): TranscriptionService {
  let accumulator: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
  let buffer: TranscriptBuffer = createTranscriptBuffer()
  let previousWindowText = ''
  let inFlight = false

  async function transcribeWindow(window: Buffer): Promise<void> {
    const scratchRoot = join(tmpdir(), WHISPER.scratchDirName)
    const wavPath = join(scratchRoot, `window-${randomUUID()}.wav`)
    try {
      await mkdir(scratchRoot, { recursive: true })
      await writeFile(wavPath, encodeWav(window, WHISPER.sampleRate))
      const result = await deps.runWhisper({
        command: deps.command ?? WHISPER.binaryName,
        prefixArgs: [],
        modelPath: deps.modelPath,
        wavPath,
        timeoutMs: WHISPER.timeoutMs
      })
      if (result.ok && result.text.length > 0) {
        const fresh = dedupOverlap(previousWindowText, result.text)
        previousWindowText = result.text
        if (fresh.length > 0) {
          buffer = appendSegment(buffer, 'you', fresh)
          deps.emit(IpcChannel.TranscriptUpdate, { segments: readSegments(buffer) })
        }
      }
    } finally {
      await rm(wavPath, { force: true }).catch(() => {})
    }
  }

  async function handleAudioFrame(payload: unknown): Promise<void> {
    const pcm = pcmOf(payload)
    if (pcm === null) return
    const pushed = pushPcm(accumulator, pcm)
    accumulator = pushed.state
    if (pushed.window === null) return
    // Single-flight: drop windows that arrive while whisper is still running
    // so the subprocess never queues up under load.
    if (inFlight) return
    inFlight = true
    try {
      await transcribeWindow(pushed.window)
    } finally {
      inFlight = false
    }
  }

  function reset(): void {
    accumulator = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    buffer = createTranscriptBuffer()
    previousWindowText = ''
  }

  return { handleAudioFrame, reset }
}
