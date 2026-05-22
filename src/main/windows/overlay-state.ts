import type { OverlayState } from '../../shared/types'

export function createOverlayState(): OverlayState {
  return { visible: false, invisible: false, clickThrough: false }
}

export function toggleInvisible(state: OverlayState): OverlayState {
  return { ...state, invisible: !state.invisible }
}

export function toggleClickThrough(state: OverlayState): OverlayState {
  return { ...state, clickThrough: !state.clickThrough }
}

export function setVisible(state: OverlayState, visible: boolean): OverlayState {
  return { ...state, visible }
}
