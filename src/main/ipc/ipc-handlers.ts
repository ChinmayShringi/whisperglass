import { IpcChannel } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
  onAskQuestion(request: unknown): void
  onStartTranscription(): void
  onStopTranscription(): void
  onAudioFrame(frame: unknown): void
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1])
  })
  ipcMain.on(IpcChannel.StartTranscription, () => deps.onStartTranscription())
  ipcMain.on(IpcChannel.StopTranscription, () => deps.onStopTranscription())
  ipcMain.on(IpcChannel.AudioFrame, (...args: unknown[]) => {
    deps.onAudioFrame(args[1])
  })
}
