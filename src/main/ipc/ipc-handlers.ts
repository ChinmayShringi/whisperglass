import { IpcChannel } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
  onAskQuestion(request: unknown): void
  onStartTranscription(): void
  onStopTranscription(): void
}

// Registers the renderer-to-main IPC channels. The Phase 3 AudioFrame channel
// is gone: in Phase 4 audio is captured by the Swift sidecar, so the renderer
// no longer produces PCM. Start/stop transcription now also drive the sidecar.
export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1])
  })
  ipcMain.on(IpcChannel.StartTranscription, () => deps.onStartTranscription())
  ipcMain.on(IpcChannel.StopTranscription, () => deps.onStopTranscription())
}
