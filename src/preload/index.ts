import { contextBridge, ipcRenderer } from 'electron'
import { createOverlayApi } from './api'

// Customcluely overlay API for renderer
const customcluelyApi = createOverlayApi(ipcRenderer)

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('customcluely', customcluelyApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.customcluely = customcluelyApi
}
