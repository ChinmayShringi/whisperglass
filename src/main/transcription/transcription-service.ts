import { join } from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { WHISPER } from '../config/constants'
import { IpcChannel, type TranscriptSegment } from '../../shared/types'
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

/** Which capture source a frame came from. Drives the speaker hint. */
export type AudioFrameSource = 'system' | 'mic'

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
  /**
   * Accepts one PCM frame. `source` selects the rolling window and the
   * speaker hint: 'mic' transcribes as 'you', 'system' as 'them'. Defaults
   * to 'mic' so any pre-Phase-4 single-argument caller stays valid.
   */
  handleAudioFrame: (payload: unknown, source?: AudioFrameSource) => Promise<void>
  /** Clears all transcript state, for a new session. */
  reset: () => void
}

// Per-source rolling state: each capture source has its own audio accumulator
// and its own previous-window text for de-duplication, but they share the one
// transcript buffer so the panel shows a single interleaved transcript.
interface SourceState {
  accumulator: PcmAccumulatorState
  previousWindowText: string
  inFlight: boolean
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

function speakerOf(source: AudioFrameSource): TranscriptSegment['speaker'] {
  return source === 'system' ? 'them' : 'you'
}

// Orchestrates transcription for both capture sources. It accumulates each
// source's PCM frames into independent rolling 8 s windows (2 s overlap), runs
// whisper on each completed window, de-duplicates the overlap against that
// source's previous window, appends the new text to the shared immutable
// transcript buffer with the matching speaker, and emits the full transcript
// to the renderer. Mirrors codex-service.ts: a per-source single-flight guard
// ensures only one whisper subprocess runs per source at a time.
export function createTranscriptionService(deps: TranscriptionServiceDeps): TranscriptionService {
  let buffer: TranscriptBuffer = createTranscriptBuffer()

  function freshSourceState(): SourceState {
    return {
      accumulator: createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES),
      previousWindowText: '',
      inFlight: false
    }
  }

  const sources: Record<AudioFrameSource, SourceState> = {
    system: freshSourceState(),
    mic: freshSourceState()
  }

  async function transcribeWindow(window: Buffer, source: AudioFrameSource): Promise<void> {
    const scratchRoot = join(tmpdir(), WHISPER.scratchDirName)
    const wavPath = join(scratchRoot, `window-${source}-${randomUUID()}.wav`)
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
        const state = sources[source]
        const fresh = dedupOverlap(state.previousWindowText, result.text)
        state.previousWindowText = result.text
        if (fresh.length > 0) {
          buffer = appendSegment(buffer, speakerOf(source), fresh)
          deps.emit(IpcChannel.TranscriptUpdate, { segments: readSegments(buffer) })
        }
      }
    } finally {
      await rm(wavPath, { force: true }).catch(() => {})
    }
  }

  async function handleAudioFrame(
    payload: unknown,
    source: AudioFrameSource = 'mic'
  ): Promise<void> {
    const pcm = pcmOf(payload)
    if (pcm === null) return
    const state = sources[source]
    const pushed = pushPcm(state.accumulator, pcm)
    state.accumulator = pushed.state
    if (pushed.window === null) return
    // Single-flight per source: drop windows that arrive while this source's
    // whisper run is still going so the subprocess never queues up.
    if (state.inFlight) return
    state.inFlight = true
    try {
      await transcribeWindow(pushed.window, source)
    } finally {
      state.inFlight = false
    }
  }

  function reset(): void {
    buffer = createTranscriptBuffer()
    sources.system = freshSourceState()
    sources.mic = freshSourceState()
  }

  return { handleAudioFrame, reset }
}
