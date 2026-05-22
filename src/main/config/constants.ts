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

export const SIDECAR = {
  // The Swift capture sidecar binary, built from source by
  // scripts/setup-sidecar.sh and committed under resources/sidecar/.
  binaryName: 'customcluely-sidecar',
  // The Electron app's bundle id. Sent on the `start` command so the sidecar
  // can exclude the app's own overlay windows from screenshots.
  appBundleId: 'com.customcluely.app',
  // Capture sources requested on `start`, matching the protocol vocabulary.
  captureSources: ['systemAudio', 'mic'],
  // Supervisor restart backoff: 1 s, 2 s, 4 s, 8 s, then capped at 8 s.
  baseBackoffMs: 1_000,
  maxBackoffMs: 8_000,
  // A sidecar that stays up at least this long is considered stable, so the
  // backoff counter resets to the base delay for the next crash.
  stableUptimeMs: 10_000
} as const

export const CONTEXT = {
  // The rolling transcript summarizer keeps this many of the most recent
  // segments verbatim so the model always sees the live thread of the
  // conversation word for word.
  recentSegments: 12,
  // Everything older than the recent window is compacted into a single
  // digest truncated to this many characters, so a long meeting cannot
  // grow the Codex prompt without bound.
  olderCharBudget: 1_200,
  // Prefix that introduces the compacted older-transcript digest.
  olderMarker: '[earlier in the meeting]'
} as const

export const INSIGHTS = {
  // The dynamic-insight surface shows at most this many insights at once.
  maxSurfaced: 5,
  // Salient terms that make a transcript segment worth surfacing as a
  // keyword insight. Lowercase; matched case-insensitively as substrings.
  keywords: [
    'deadline',
    'budget',
    'risk',
    'blocker',
    'decision',
    'action item',
    'next step',
    'timeline',
    'owner',
    'priority'
  ]
} as const
