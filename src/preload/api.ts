import {
  IpcChannel,
  type OverlayState,
  type AskQuestionRequest,
  type ContextAskRequest,
  type AnswerChunk,
  type AnswerResult,
  type AnswerError,
  type CodexStatus,
  type TranscriptUpdatePayload,
  type TranscriptionStatusPayload,
  type SidecarStatusPayload,
  type ScreenshotPayload
} from '../shared/types'

export interface IpcRendererLike {
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: unknown[]) => void): void
  removeListener?(channel: string, listener: (...args: unknown[]) => void): void
}

export interface OverlayApi {
  toggleInvisibility(): void
  onOverlayState(callback: (state: OverlayState) => void): () => void
  askQuestion(request: AskQuestionRequest): void
  askContextQuestion(request: ContextAskRequest): void
  requestScreenshot(): void
  onAnswerChunk(callback: (chunk: AnswerChunk) => void): () => void
  onAnswerDone(callback: (result: AnswerResult) => void): () => void
  onAnswerError(callback: (error: AnswerError) => void): () => void
  onCodexStatus(callback: (status: CodexStatus) => void): () => void
  startTranscription(): void
  stopTranscription(): void
  onTranscriptUpdate(callback: (update: TranscriptUpdatePayload) => void): () => void
  onTranscriptionStatus(callback: (status: TranscriptionStatusPayload) => void): () => void
  onSidecarStatus(callback: (status: SidecarStatusPayload) => void): () => void
  onScreenshot(callback: (screenshot: ScreenshotPayload) => void): () => void
}

export function createOverlayApi(ipcRenderer: IpcRendererLike): OverlayApi {
  function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
    const listener = (_event: unknown, payload: T): void => callback(payload)
    ipcRenderer.on(channel, listener as (...args: unknown[]) => void)
    return () => ipcRenderer.removeListener?.(channel, listener as (...args: unknown[]) => void)
  }
  return {
    toggleInvisibility: () => ipcRenderer.send(IpcChannel.ToggleInvisibility),
    onOverlayState: (callback) => subscribe(IpcChannel.OverlayState, callback),
    askQuestion: (request) => ipcRenderer.send(IpcChannel.AskQuestion, request),
    askContextQuestion: (request) => ipcRenderer.send(IpcChannel.AskContextQuestion, request),
    requestScreenshot: () => ipcRenderer.send(IpcChannel.RequestScreenshot),
    onAnswerChunk: (callback) => subscribe(IpcChannel.AnswerChunk, callback),
    onAnswerDone: (callback) => subscribe(IpcChannel.AnswerDone, callback),
    onAnswerError: (callback) => subscribe(IpcChannel.AnswerError, callback),
    onCodexStatus: (callback) => subscribe(IpcChannel.CodexStatus, callback),
    startTranscription: () => ipcRenderer.send(IpcChannel.StartTranscription),
    stopTranscription: () => ipcRenderer.send(IpcChannel.StopTranscription),
    onTranscriptUpdate: (callback) => subscribe(IpcChannel.TranscriptUpdate, callback),
    onTranscriptionStatus: (callback) => subscribe(IpcChannel.TranscriptionStatus, callback),
    onSidecarStatus: (callback) => subscribe(IpcChannel.SidecarStatus, callback),
    onScreenshot: (callback) => subscribe(IpcChannel.Screenshot, callback)
  }
}
