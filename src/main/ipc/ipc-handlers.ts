import { IpcChannel } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
  onAskQuestion(request: unknown): void
  /** A transcript-and-screenshot-aware Codex query from the renderer. */
  onAskContextQuestion(request: unknown): void
  onStartTranscription(): void
  onStopTranscription(): void
  /** The renderer asked the sidecar to capture a screenshot. */
  onRequestScreenshot(): void
}

// Registers the renderer-to-main IPC channels. Phase 5 adds two: a
// transcript-and-screenshot-aware context-ask channel and a screenshot
// request channel that drives the sidecar.
export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1])
  })
  ipcMain.on(IpcChannel.AskContextQuestion, (...args: unknown[]) => {
    deps.onAskContextQuestion(args[1])
  })
  ipcMain.on(IpcChannel.StartTranscription, () => deps.onStartTranscription())
  ipcMain.on(IpcChannel.StopTranscription, () => deps.onStopTranscription())
  ipcMain.on(IpcChannel.RequestScreenshot, () => deps.onRequestScreenshot())
}
