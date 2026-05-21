import type { HotkeyAction } from '../../shared/types'
import { GLOBAL_HOTKEYS } from '../config/constants'

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregisterAll(): void
}

export function registerGlobalHotkeys(
  globalShortcut: GlobalShortcutLike,
  onAction: (action: HotkeyAction) => void,
): void {
  for (const [accelerator, action] of Object.entries(GLOBAL_HOTKEYS)) {
    globalShortcut.register(accelerator, () => onAction(action))
  }
}

export function unregisterGlobalHotkeys(globalShortcut: GlobalShortcutLike): void {
  globalShortcut.unregisterAll()
}
