import type { OverlayState } from '../../shared/types'

export interface OverlayWindowLike {
  setContentProtection(enabled: boolean): void
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void
  show(): void
  hide(): void
}

export function applyOverlayState(win: OverlayWindowLike, state: OverlayState): void {
  win.setContentProtection(state.invisible)
  win.setIgnoreMouseEvents(state.clickThrough, { forward: true })
  if (state.visible) {
    win.show()
  } else {
    win.hide()
  }
}
