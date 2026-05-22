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

export const WHISPER = {
  // Bundled whisper.cpp v1.8.4 binary, built from source by
  // scripts/setup-whisper.sh and committed under resources/whisper/.
  binaryName: 'whisper-cli',
  // Default English-only model. Downloaded on first run, never committed.
  // Accuracy upgrade: ggml-small.en.bin (466 MiB) - not used in Phase 3.
  modelFileName: 'ggml-base.en.bin',
  modelUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  // Exact byte size of ggml-base.en.bin, used to detect a complete download.
  modelByteSize: 147_964_211,
  // whisper.cpp requires 16 kHz mono 16-bit PCM.
  sampleRate: 16_000,
  // Rolling-window transcription: 8 s windows with 2 s overlap, so a new
  // window starts every 6 s of fresh audio. 8 s gives whisper enough phrase
  // context; 2 s of overlap spans word boundaries for de-duplication.
  windowSeconds: 8,
  overlapSeconds: 2,
  // Renderer ships PCM in 1-second frames.
  frameSeconds: 1,
  // Per-window whisper-cli timeout.
  timeoutMs: 30_000,
  scratchDirName: '.whisper-scratch'
} as const
