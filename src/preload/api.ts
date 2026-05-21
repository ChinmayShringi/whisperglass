import {
  IpcChannel,
  type OverlayState,
  type AskQuestionRequest,
  type AnswerChunk,
  type AnswerResult,
  type AnswerError,
  type CodexStatus,
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
  onAnswerChunk(callback: (chunk: AnswerChunk) => void): () => void
  onAnswerDone(callback: (result: AnswerResult) => void): () => void
  onAnswerError(callback: (error: AnswerError) => void): () => void
  onCodexStatus(callback: (status: CodexStatus) => void): () => void
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
    onAnswerChunk: (callback) => subscribe(IpcChannel.AnswerChunk, callback),
    onAnswerDone: (callback) => subscribe(IpcChannel.AnswerDone, callback),
    onAnswerError: (callback) => subscribe(IpcChannel.AnswerError, callback),
    onCodexStatus: (callback) => subscribe(IpcChannel.CodexStatus, callback),
  }
}
