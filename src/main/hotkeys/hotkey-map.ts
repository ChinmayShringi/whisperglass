import type { HotkeyAction } from '../../shared/types'
import { GLOBAL_HOTKEYS } from '../config/constants'

export function resolveHotkeyAction(accelerator: string): HotkeyAction | undefined {
  return GLOBAL_HOTKEYS[accelerator]
}
