export const IpcChannel = {
  ToggleInvisibility: 'overlay:toggle-invisibility',
  OverlayState: 'overlay:state',
  AskQuestion: 'codex:ask',
  AnswerChunk: 'codex:answer-chunk',
  AnswerDone: 'codex:answer-done',
  AnswerError: 'codex:answer-error',
  CodexStatus: 'codex:status',
  StartTranscription: 'transcription:start',
  StopTranscription: 'transcription:stop',
  AudioFrame: 'transcription:audio-frame',
  TranscriptUpdate: 'transcription:update',
  TranscriptionStatus: 'transcription:status'
} as const

export type HotkeyAction =
  | 'show-hide'
  | 'toggle-invisibility'
  | 'toggle-click-through'
  | 'move-up'
  | 'move-down'
  | 'move-left'
  | 'move-right'

export interface OverlayState {
  visible: boolean
  invisible: boolean
  clickThrough: boolean
}

export interface TranscriptSegment {
  id: string
  speaker: 'you' | 'them'
  text: string
}

export interface CodexStatus {
  available: boolean
  authenticated: boolean
  detail: string
}

export interface AskQuestionRequest {
  requestId: string
  question: string
}

export interface AnswerChunk {
  requestId: string
  delta: string
}

export interface AnswerResult {
  requestId: string
  text: string
}

export interface AnswerError {
  requestId: string
  message: string
}

/**
 * One chunk of microphone PCM crossing IPC from renderer to main. `pcmBase64`
 * is base64-encoded signed 16-bit little-endian mono PCM at 16 kHz. Phase 4
 * replaces this channel with the Swift sidecar.
 */
export interface AudioFramePayload {
  pcmBase64: string
}

/** The full immutable transcript pushed to the renderer after every change. */
export interface TranscriptUpdatePayload {
  segments: TranscriptSegment[]
}

/** Reports whether on-device transcription is ready to run. */
export interface TranscriptionStatusPayload {
  ready: boolean
  detail: string
}
