export const IpcChannel = {
  ToggleInvisibility: 'overlay:toggle-invisibility',
  OverlayState: 'overlay:state',
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
