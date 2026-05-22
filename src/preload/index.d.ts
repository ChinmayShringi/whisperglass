import type { OverlayApi } from './api'

declare global {
  interface Window {
    whisperglass: OverlayApi
  }
}
