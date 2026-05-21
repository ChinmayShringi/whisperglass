import { ElectronAPI } from '@electron-toolkit/preload'
import type { OverlayApi } from './api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    customcluely: OverlayApi
  }
}
