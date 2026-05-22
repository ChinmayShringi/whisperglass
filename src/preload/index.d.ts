import type { OverlayApi } from './api'

declare global {
  interface Window {
    customcluely: OverlayApi
  }
}
