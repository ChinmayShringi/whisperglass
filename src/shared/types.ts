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
  TranscriptUpdate: 'transcription:update',
  TranscriptionStatus: 'transcription:status',
  SidecarStatus: 'sidecar:status',
  Screenshot: 'sidecar:screenshot'
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

/** The full immutable transcript pushed to the renderer after every change. */
export interface TranscriptUpdatePayload {
  segments: TranscriptSegment[]
}

/** Reports whether on-device transcription is ready to run. */
export interface TranscriptionStatusPayload {
  ready: boolean
  detail: string
}

/**
 * Reports the live state of the Swift capture sidecar. `paused` is shown to
 * the user as an "audio paused" banner while the supervisor restarts a
 * crashed sidecar.
 */
export interface SidecarStatusPayload {
  state: 'capturing' | 'paused' | 'stopped' | 'error'
  detail: string
}

/** One on-demand screenshot delivered by the sidecar, as a base64 PNG. */
export interface ScreenshotPayload {
  format: 'png'
  dataBase64: string
}
