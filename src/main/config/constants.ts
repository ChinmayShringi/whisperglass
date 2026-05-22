import type { HotkeyAction } from '../../shared/types'

export const OVERLAY = {
  width: 720,
  height: 480,
  marginTop: 24
} as const

export const MOVE_STEP_PX = 40

// Global shortcuts handled entirely in the main process. The submit,
// answer-insight, and stealth-answer hotkeys arrive in later phases, when
// the renderer has logic to consume them.
export const GLOBAL_HOTKEYS: Record<string, HotkeyAction> = {
  'CommandOrControl+\\': 'show-hide',
  'CommandOrControl+Shift+\\': 'toggle-invisibility',
  'CommandOrControl+Shift+M': 'toggle-click-through',
  'CommandOrControl+Up': 'move-up',
  'CommandOrControl+Down': 'move-down',
  'CommandOrControl+Left': 'move-left',
  'CommandOrControl+Right': 'move-right'
}

export const CODEX = {
  // Absolute candidate locations for the codex binary, in priority order.
  // Resolving an absolute path avoids a PATH-lookup hijack surface.
  knownPaths: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
  // Last-resort fallback when no absolute path can be resolved.
  command: 'codex',
  timeoutMs: 60_000,
  scratchDirName: '.codex-scratch',
  reasoningEffort: 'low'
} as const
