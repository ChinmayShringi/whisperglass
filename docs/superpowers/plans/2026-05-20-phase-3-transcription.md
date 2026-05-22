# Phase 3: Local Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the roadmap, every task runs through the 3-agent pipeline (implementer, auditor, documenter).

**Goal:** Transcribe microphone audio on-device with bundled whisper.cpp so that speaking produces live transcript text in the overlay with no network call for transcription.

**Architecture:** The user starts a listening session with an explicit "Start listening" toggle; only then does the renderer call `getUserMedia` and capture microphone audio with an `AudioWorklet`, downsample it to 16 kHz mono 16-bit PCM, and ship fixed-size PCM frames to the main process over IPC as base64 strings. The main process accumulates frames into a rolling overlapping audio window, writes each window to a temporary 16 kHz mono WAV file, spawns the bundled `whisper-cli` subprocess on it, parses the JSON output, de-duplicates the overlap against the previous window, and appends new text to an immutable rolling transcript buffer. Buffer updates are pushed back to the renderer and rendered by the existing `TranscriptPanel`. Stopping the session releases the microphone tracks and resets the rolling audio state so a new session never inherits stale audio. The whisper modules mirror the proven `src/main/codex/` structure: pure dependency-injected logic plus one subprocess runner.

**Tech Stack:** Electron 39, TypeScript (no semicolons, single quotes, 2-space indent, prettier `trailingComma: none`), React 19, electron-vite, whisper.cpp v1.8.4 (built from source with CMake, Metal backend), Vitest 4 (no globals, node default environment, jsdom for renderer tests).

---

## Pinned research facts (do not re-research)

These were verified on 2026-05-22. Treat them as fixed inputs.

1. **whisper.cpp version.** Latest release is `v1.8.4`, published 2026-03-19 (verified via the GitHub releases API for `ggml-org/whisper.cpp`). The plan pins this exact tag.

2. **Binary sourcing decision: build from source at dev time.** whisper.cpp does not publish a prebuilt macOS arm64 `whisper-cli` binary that is safe to bundle blindly, and the Metal backend must be compiled for the host. The plan ships a dev-time setup script (`scripts/setup-whisper.sh`) that clones the pinned `v1.8.4` tag, builds with `cmake -B build` then `cmake --build build --config Release -j`, and copies the resulting `build/bin/whisper-cli` into `resources/whisper/whisper-cli`. Metal is enabled by default on macOS, so no extra flag is needed. The compiled binary IS committed to git (it is a few MB and the project must run without a network); only the model `.bin` is gitignored (`resources/whisper/*.bin` is already in `.gitignore`).

3. **whisper-cli flags.** Modern whisper.cpp renamed `main` to `whisper-cli`. The flags this plan uses, all verified against the v1.8.x CLI source:
   - `-m <path>` / `--model` selects the ggml model file.
   - `-f <path>` / `--file` selects the input audio file. Input must be a 16 kHz mono 16-bit PCM WAV.
   - `-oj` / `--output-json` writes a JSON file next to the input named `<input>.json`.
   - `-nt` / `--no-timestamps` suppresses timestamps in console output.
   - `-np` / `--no-prints` suppresses everything except results on stdout.
   - `-l en` / `--language en` pins English (the bundled model is English-only, but passing it is explicit and harmless).
   The JSON file has the shape `{ "transcription": [ { "timestamps": {...}, "offsets": { "from": <ms>, "to": <ms> }, "text": "<segment text>" }, ... ] }`. The plan reads `transcription[].text` and joins.

4. **Model download.** The default model is `ggml-base.en.bin` (142 MiB; exact size `147964211` bytes, verified via the Hugging Face `x-linked-size` header). Canonical download URL: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`. `ggml-small.en.bin` (466 MiB) is the accuracy upgrade and is recorded in the `WHISPER` constants as a commented note but is NOT downloaded by Phase 3. The model is downloaded on first run into `resources/whisper/ggml-base.en.bin`; it is gitignored and never committed.

5. **Microphone capture.** In an Electron renderer, `navigator.mediaDevices.getUserMedia({ audio: true })` returns a `MediaStream`. A `MediaStreamAudioSourceNode` feeds an `AudioWorkletNode`. The browser `AudioContext` typically runs at 44100 or 48000 Hz, so the worklet must downsample to 16000 Hz and convert Float32 samples in `[-1, 1]` to signed 16-bit integers (`Math.round(clamped * 32767)`). `AudioWorklet` is used rather than the deprecated `ScriptProcessorNode` because the worklet runs on a dedicated audio thread and does not block the UI. The worklet posts `Float32Array` blocks to the main thread, where a pure downsampler converts them to `Int16Array` PCM. This renderer mic path is a deliberate STOPGAP: Phase 4 replaces it with the Swift sidecar, so the audio-source boundary is kept clean (the worklet plus the `AudioFrame` IPC payload are the entire seam Phase 4 swaps out).

## Decisions recorded (the spec's deferred open items)

- **Build vs prebuilt:** build from source at dev time via `scripts/setup-whisper.sh` (see fact 2). The compiled `whisper-cli` is committed; the model is not.
- **Rolling window size and overlap:** **8-second windows with 2 seconds of overlap** (a fresh window every 6 seconds of new audio). 8 seconds gives whisper enough phrase context for accurate base.en transcription while keeping each `whisper-cli` invocation well under a second on Apple Silicon; 2 seconds of overlap reliably spans word and short-phrase boundaries so the de-duplicator can stitch consecutive windows without dropping or doubling words.
- **Audio across IPC:** mic PCM frames cross IPC as **base64-encoded 16-bit PCM strings**. This is the simplest correct approach: it avoids transferable-buffer lifetime pitfalls and is trivially serializable by Electron's structured-clone IPC. Frames are small (a 1-second 16 kHz mono frame is 32 KB of PCM, about 43 KB base64). Phase 4 moves capture into the Swift sidecar and this IPC channel is removed.
- **Explicit "Start listening" toggle:** transcription is **not** started on app mount. The user activates a dedicated `ListenToggle` button, and only that activation calls `getUserMedia`, so the macOS microphone permission prompt fires on a deliberate user action. Stopping releases the `MediaStream` tracks (the macOS mic indicator turns off) and resets the main-process rolling audio state. This gives the user clear control over when the microphone is live.

---

## File Structure

Every file created or modified in Phase 3, with its single responsibility.

### Created - shared

- `src/shared/types.ts` (MODIFIED) - adds the Phase 3 IPC channels (`StartTranscription`, `StopTranscription`, `AudioFrame`, `TranscriptUpdate`, `TranscriptionStatus`) and the `AudioFramePayload`, `TranscriptUpdatePayload`, and `TranscriptionStatusPayload` interfaces, in the existing style.

### Created - main process (`src/main/`)

- `src/main/config/constants.ts` (MODIFIED) - adds the `WHISPER` const (model file name, binary name, sample rate, window and overlap durations, frame duration, download URL, expected model byte size) following the `CODEX` pattern.
- `src/main/transcription/resolve-whisper-paths.ts` - pure resolver for the bundled `whisper-cli` binary path and the model path, given a resources root; reports which assets are missing.
- `src/main/transcription/model-downloader.ts` - downloads `ggml-base.en.bin` on first run with progress callbacks; dependency-injected HTTP and filesystem so it is fully unit-tested.
- `src/main/transcription/pcm-accumulator.ts` - immutable accumulator that collects incoming PCM frames and, when enough audio for one window is buffered, emits a window and retains the trailing overlap.
- `src/main/transcription/wav-encoder.ts` - pure function that wraps a 16-bit PCM `Buffer` in a 16 kHz mono WAV container (44-byte header).
- `src/main/transcription/whisper-json-parser.ts` - pure parser that turns whisper.cpp JSON output text into an ordered array of segment strings.
- `src/main/transcription/overlap-dedup.ts` - pure function that, given the previous window's tail text and the new window's text, returns only the genuinely new text.
- `src/main/transcription/transcript-buffer.ts` - the immutable rolling transcript buffer: append a segment, read all segments, each operation returns a new buffer.
- `src/main/transcription/whisper-runner.ts` - spawns `whisper-cli` on a WAV file, waits for exit, reads and parses the JSON output file; mirrors `codex-runner.ts`.
- `src/main/transcription/transcription-service.ts` - orchestrator: receives audio frames, drives the accumulator, runs whisper per window, de-duplicates, appends to the buffer, emits transcript updates; mirrors `codex-service.ts`.
- `src/main/ipc/ipc-handlers.ts` (MODIFIED) - registers the `StartTranscription`, `StopTranscription`, and `AudioFrame` channels.
- `src/main/index.ts` (MODIFIED) - resolves whisper paths, kicks off the model download, constructs the `TranscriptionService`, wires the new IPC handlers, emits transcription status.

### Created - preload (`src/preload/`)

- `src/preload/api.ts` (MODIFIED) - adds `startTranscription`, `stopTranscription`, `sendAudioFrame`, `onTranscriptUpdate`, and `onTranscriptionStatus` to `OverlayApi`.

### Created - renderer (`src/renderer/`)

- `src/renderer/src/audio/pcm-worklet.ts` - the `AudioWorkletProcessor` source, emitted as a string and registered into the `AudioContext`; posts raw Float32 audio blocks to the main thread.
- `src/renderer/src/audio/downsample.ts` - pure functions: downsample a Float32 block from the source rate to 16 kHz, and convert Float32 to Int16 PCM.
- `src/renderer/src/audio/mic-capture.ts` - the start/stop microphone capture seam: `startMicCapture` calls `getUserMedia` (firing the macOS permission prompt) only when invoked, and the returned handle's `stop` releases the `MediaStream` tracks so the mic indicator turns off. The single seam Phase 4 replaces.
- `src/renderer/src/components/ListenToggle.tsx` - a small dedicated button (mirrors `EyeToggle.tsx`) that shows the listening state and toggles it; capture starts only on user activation.
- `src/renderer/src/hooks/useTranscript.ts` - React hook that exposes the live transcript segments plus `listening` state and `startListening`/`stopListening` actions; mirrors `useCodexAnswer.ts`. Capture is never started on mount.
- `src/renderer/src/App.tsx` (MODIFIED) - replaces the static empty `segments` state with the `useTranscript` hook output and renders the `ListenToggle` in the command bar.

### Created - scripts and resources

- `scripts/setup-whisper.sh` - dev-time script that builds `whisper-cli` v1.8.4 from source and installs it into `resources/whisper/`.
- `resources/whisper/whisper-cli` - the compiled binary, committed (produced by the setup script).
- `resources/whisper/.gitkeep` - keeps the directory in git (the `.bin` model is gitignored).

### Created - tests (`tests/`)

- `tests/main/transcription/resolve-whisper-paths.test.ts`
- `tests/main/transcription/model-downloader.test.ts`
- `tests/main/transcription/pcm-accumulator.test.ts`
- `tests/main/transcription/wav-encoder.test.ts`
- `tests/main/transcription/whisper-json-parser.test.ts`
- `tests/main/transcription/overlap-dedup.test.ts`
- `tests/main/transcription/transcript-buffer.test.ts`
- `tests/main/transcription/whisper-runner.test.ts`
- `tests/main/transcription/transcription-service.test.ts`
- `tests/main/ipc/ipc-handlers.test.ts` (MODIFIED) - adds coverage for the three new channels.
- `tests/renderer/audio/downsample.test.ts`
- `tests/renderer/hooks/useTranscript.test.ts`
- `tests/renderer/components/ListenToggle.test.tsx`
- `tests/fixtures/whisper/mock-whisper-ok.mjs` - mock `whisper-cli` that writes a valid JSON output file and exits 0.
- `tests/fixtures/whisper/mock-whisper-fail.mjs` - mock `whisper-cli` that writes to stderr and exits 1.
- `tests/fixtures/whisper/sample-output.json` - a captured whisper.cpp JSON output file used by the parser test.

### Created - docs

- `docs/superpowers/verification/2026-05-20-phase-3.md` - the Phase 3 verification doc (automated checks plus manual checklist).

---

## Task 1: WHISPER constants and Phase 3 shared types

**Files:**
- Modify: `src/main/config/constants.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts`

- [ ] **Step 1: Write the failing test**

Append these cases to `tests/shared/types.test.ts` inside the existing top-level `describe` (or add a new `describe`). Add the import `WHISPER` from `'../../src/main/config/constants'` at the top of the file and keep the existing imports.

```typescript
import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'
import { WHISPER } from '../../src/main/config/constants'

describe('Phase 3 IpcChannel entries', () => {
  it('defines the transcription channels', () => {
    expect(IpcChannel.StartTranscription).toBe('transcription:start')
    expect(IpcChannel.StopTranscription).toBe('transcription:stop')
    expect(IpcChannel.AudioFrame).toBe('transcription:audio-frame')
    expect(IpcChannel.TranscriptUpdate).toBe('transcription:update')
    expect(IpcChannel.TranscriptionStatus).toBe('transcription:status')
  })
})

describe('WHISPER constants', () => {
  it('pins the model file, sample rate, and window timing', () => {
    expect(WHISPER.modelFileName).toBe('ggml-base.en.bin')
    expect(WHISPER.binaryName).toBe('whisper-cli')
    expect(WHISPER.sampleRate).toBe(16000)
    expect(WHISPER.windowSeconds).toBe(8)
    expect(WHISPER.overlapSeconds).toBe(2)
    expect(WHISPER.frameSeconds).toBe(1)
    expect(WHISPER.modelByteSize).toBe(147964211)
    expect(WHISPER.modelUrl).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/shared/types.test.ts`
Expected: FAIL with errors such as `Cannot find module '../../src/main/config/constants'` resolving `WHISPER` not exporting the new fields, and `expect(IpcChannel.StartTranscription).toBe(...)` receiving `undefined`.

- [ ] **Step 3: Add the Phase 3 channels and types to `src/shared/types.ts`**

Replace the entire contents of `src/shared/types.ts` with:

```typescript
export const IpcChannel = {
  ToggleInvisibility: 'overlay:toggle-invisibility',
  OverlayState: 'overlay:state',
  AskQuestion: 'codex:ask',
  AnswerChunk: 'codex:answer-chunk',
  AnswerDone: 'codex:answer-done',
  AnswerError: 'codex:answer-error',
  CodexStatus: 'codex:status',
  StartTranscription: 'transcription:start',
  StopTranscription: 'transcription:stop',
  AudioFrame: 'transcription:audio-frame',
  TranscriptUpdate: 'transcription:update',
  TranscriptionStatus: 'transcription:status'
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

export interface CodexStatus {
  available: boolean
  authenticated: boolean
  detail: string
}

export interface AskQuestionRequest {
  requestId: string
  question: string
}

export interface AnswerChunk {
  requestId: string
  delta: string
}

export interface AnswerResult {
  requestId: string
  text: string
}

export interface AnswerError {
  requestId: string
  message: string
}

/**
 * One chunk of microphone PCM crossing IPC from renderer to main. `pcmBase64`
 * is base64-encoded signed 16-bit little-endian mono PCM at 16 kHz. Phase 4
 * replaces this channel with the Swift sidecar.
 */
export interface AudioFramePayload {
  pcmBase64: string
}

/** The full immutable transcript pushed to the renderer after every change. */
export interface TranscriptUpdatePayload {
  segments: TranscriptSegment[]
}

/** Reports whether on-device transcription is ready to run. */
export interface TranscriptionStatusPayload {
  ready: boolean
  detail: string
}
```

- [ ] **Step 4: Add the `WHISPER` const to `src/main/config/constants.ts`**

Append this block to the end of `src/main/config/constants.ts` (after the existing `CODEX` const, do not change anything above it):

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- tests/shared/types.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/config/constants.ts tests/shared/types.test.ts
git commit -m "feat: add Phase 3 transcription IPC channels and WHISPER constants"
```

---

## Task 2: Whisper path resolver

**Files:**
- Create: `src/main/transcription/resolve-whisper-paths.ts`
- Test: `tests/main/transcription/resolve-whisper-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/resolve-whisper-paths.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolveWhisperPaths } from '../../../src/main/transcription/resolve-whisper-paths'

describe('resolveWhisperPaths', () => {
  it('builds the binary and model paths under the resources root', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: () => true
    })
    expect(result.binaryPath).toBe('/app/resources/whisper/whisper-cli')
    expect(result.modelPath).toBe('/app/resources/whisper/ggml-base.en.bin')
  })

  it('reports the binary present when the file exists', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: (p) => p === '/app/resources/whisper/whisper-cli'
    })
    expect(result.binaryPresent).toBe(true)
    expect(result.modelPresent).toBe(false)
  })

  it('reports the model present when the file exists', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: (p) => p === '/app/resources/whisper/ggml-base.en.bin'
    })
    expect(result.binaryPresent).toBe(false)
    expect(result.modelPresent).toBe(true)
  })

  it('reports both missing when nothing exists', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: () => false
    })
    expect(result.binaryPresent).toBe(false)
    expect(result.modelPresent).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/resolve-whisper-paths.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/resolve-whisper-paths'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/resolve-whisper-paths.ts`:

```typescript
import { join } from 'node:path'
import { WHISPER } from '../config/constants'

export interface ResolveWhisperPathsDeps {
  /** Absolute path to the app resources directory. */
  resourcesRoot: string
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
}

export interface WhisperPaths {
  binaryPath: string
  modelPath: string
  binaryPresent: boolean
  modelPresent: boolean
}

// Pure resolver for the bundled whisper.cpp binary and model. It never throws
// and never touches the real filesystem: existence is dependency-injected.
export function resolveWhisperPaths(deps: ResolveWhisperPathsDeps): WhisperPaths {
  const binaryPath = join(deps.resourcesRoot, 'whisper', WHISPER.binaryName)
  const modelPath = join(deps.resourcesRoot, 'whisper', WHISPER.modelFileName)
  return {
    binaryPath,
    modelPath,
    binaryPresent: deps.fileExists(binaryPath),
    modelPresent: deps.fileExists(modelPath)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/resolve-whisper-paths.test.ts`
Expected: PASS, 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/resolve-whisper-paths.ts tests/main/transcription/resolve-whisper-paths.test.ts
git commit -m "feat: add whisper binary and model path resolver"
```

---

## Task 3: Model downloader

**Files:**
- Create: `src/main/transcription/model-downloader.ts`
- Test: `tests/main/transcription/model-downloader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/model-downloader.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { downloadModel } from '../../../src/main/transcription/model-downloader'

function fakeStream(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  }
}

describe('downloadModel', () => {
  it('returns already-present without fetching when the model exists at full size', async () => {
    const fetchHttp = vi.fn()
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 100,
      fileExists: () => true,
      fileSize: () => 100,
      fetchHttp,
      writeStream: vi.fn(),
      onProgress: vi.fn()
    })
    expect(result.ok).toBe(true)
    expect(result.alreadyPresent).toBe(true)
    expect(fetchHttp).not.toHaveBeenCalled()
  })

  it('downloads when the model is missing and reports progress', async () => {
    const progress: number[] = []
    const writeStream = vi.fn(async () => {})
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 6,
      fileExists: () => false,
      fileSize: () => 0,
      fetchHttp: async () => ({ totalBytes: 6, body: fakeStream([Buffer.from('abc'), Buffer.from('def')]) }),
      writeStream,
      onProgress: (fraction) => progress.push(fraction)
    })
    expect(result.ok).toBe(true)
    expect(result.alreadyPresent).toBe(false)
    expect(writeStream).toHaveBeenCalledOnce()
    expect(progress[progress.length - 1]).toBe(1)
  })

  it('re-downloads when an existing file is the wrong size', async () => {
    const fetchHttp = vi.fn(async () => ({
      totalBytes: 6,
      body: fakeStream([Buffer.from('abcdef')])
    }))
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 6,
      fileExists: () => true,
      fileSize: () => 3,
      fetchHttp,
      writeStream: vi.fn(async () => {}),
      onProgress: vi.fn()
    })
    expect(result.ok).toBe(true)
    expect(fetchHttp).toHaveBeenCalledOnce()
  })

  it('returns not-ok with a message when the fetch throws', async () => {
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 6,
      fileExists: () => false,
      fileSize: () => 0,
      fetchHttp: async () => {
        throw new Error('network down')
      },
      writeStream: vi.fn(),
      onProgress: vi.fn()
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network down')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/model-downloader.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/model-downloader'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/model-downloader.ts`:

```typescript
export interface HttpResponse {
  /** Total content length in bytes, or null when the server omits it. */
  totalBytes: number | null
  /** The response body as an async iterable of chunks. */
  body: AsyncIterable<Buffer>
}

export interface DownloadModelDeps {
  /** Absolute path the model is written to. */
  modelPath: string
  /** The model download URL. */
  url: string
  /** Expected final byte size of a complete model file. */
  expectedBytes: number
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
  /** Byte size of the file at the given path. */
  fileSize: (path: string) => number
  /** Performs the HTTP GET and returns the streaming response. */
  fetchHttp: (url: string) => Promise<HttpResponse>
  /** Writes all chunks to the model path. */
  writeStream: (path: string, chunks: Buffer[]) => Promise<void>
  /** Progress callback, fraction in [0, 1]. */
  onProgress: (fraction: number) => void
}

export interface DownloadModelResult {
  ok: boolean
  alreadyPresent: boolean
  error: string
}

// Downloads the whisper model on first run. Pure orchestration: HTTP and
// filesystem are dependency-injected so the whole flow is unit-tested. A file
// already present at the exact expected size is treated as complete; any
// other size triggers a re-download.
export async function downloadModel(deps: DownloadModelDeps): Promise<DownloadModelResult> {
  if (deps.fileExists(deps.modelPath) && deps.fileSize(deps.modelPath) === deps.expectedBytes) {
    deps.onProgress(1)
    return { ok: true, alreadyPresent: true, error: '' }
  }
  try {
    const response = await deps.fetchHttp(deps.url)
    const total = response.totalBytes ?? deps.expectedBytes
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of response.body) {
      chunks.push(chunk)
      received += chunk.length
      const fraction = total > 0 ? Math.min(received / total, 1) : 0
      deps.onProgress(fraction)
    }
    await deps.writeStream(deps.modelPath, chunks)
    deps.onProgress(1)
    return { ok: true, alreadyPresent: false, error: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown download error.'
    return { ok: false, alreadyPresent: false, error: `Model download failed: ${message}` }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/model-downloader.test.ts`
Expected: PASS, 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/model-downloader.ts tests/main/transcription/model-downloader.test.ts
git commit -m "feat: add whisper model download-on-first-run with progress"
```

---

## Task 4: PCM accumulator (rolling audio window)

**Files:**
- Create: `src/main/transcription/pcm-accumulator.ts`
- Test: `tests/main/transcription/pcm-accumulator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/pcm-accumulator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  createPcmAccumulator,
  pushPcm,
  type PcmAccumulatorState
} from '../../../src/main/transcription/pcm-accumulator'

// 16 kHz mono 16-bit PCM: 2 bytes per sample, 32000 bytes per second.
// windowBytes = 8 s = 256000; overlapBytes = 2 s = 64000.
const WINDOW_BYTES = 256_000
const OVERLAP_BYTES = 64_000

function frame(byteLength: number, fill: number): Buffer {
  return Buffer.alloc(byteLength, fill)
}

describe('pcm-accumulator', () => {
  it('starts empty and emits no window', () => {
    const state = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    expect(state.buffered.length).toBe(0)
  })

  it('buffers frames without emitting until a full window is reached', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    const result = pushPcm(state, frame(32_000, 1))
    state = result.state
    expect(result.window).toBeNull()
    expect(state.buffered.length).toBe(32_000)
  })

  it('emits a window of exactly windowBytes once enough audio is buffered', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    let emitted: Buffer | null = null
    for (let i = 0; i < 8; i += 1) {
      const result = pushPcm(state, frame(32_000, i + 1))
      state = result.state
      if (result.window) emitted = result.window
    }
    expect(emitted).not.toBeNull()
    expect(emitted?.length).toBe(WINDOW_BYTES)
  })

  it('retains exactly the trailing overlap after emitting a window', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    for (let i = 0; i < 8; i += 1) {
      state = pushPcm(state, frame(32_000, i + 1)).state
    }
    expect(state.buffered.length).toBe(OVERLAP_BYTES)
  })

  it('does not mutate the input state', () => {
    const state = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    pushPcm(state, frame(32_000, 1))
    expect(state.buffered.length).toBe(0)
  })

  it('emits a window whose tail bytes equal the retained overlap', () => {
    let state: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    let emitted: Buffer | null = null
    for (let i = 0; i < 8; i += 1) {
      const result = pushPcm(state, frame(32_000, i + 1))
      state = result.state
      if (result.window) emitted = result.window
    }
    const tail = emitted!.subarray(WINDOW_BYTES - OVERLAP_BYTES)
    expect(Buffer.compare(tail, state.buffered)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/pcm-accumulator.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/pcm-accumulator'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/pcm-accumulator.ts`:

```typescript
export interface PcmAccumulatorState {
  /** PCM bytes buffered so far, not yet emitted as a window. */
  readonly buffered: Buffer
  /** Window size in bytes. */
  readonly windowBytes: number
  /** Overlap size in bytes, retained after each emitted window. */
  readonly overlapBytes: number
}

export interface PushPcmResult {
  state: PcmAccumulatorState
  /** A full window of exactly windowBytes, or null when not yet ready. */
  window: Buffer | null
}

// Creates an empty rolling-window accumulator. windowBytes and overlapBytes
// are derived from WHISPER timing by the caller (8 s window, 2 s overlap).
export function createPcmAccumulator(
  windowBytes: number,
  overlapBytes: number
): PcmAccumulatorState {
  return { buffered: Buffer.alloc(0), windowBytes, overlapBytes }
}

// Appends a PCM frame. When the buffer reaches a full window it emits exactly
// windowBytes and retains the trailing overlapBytes for the next window so
// consecutive windows overlap. Immutable: returns a new state, never mutates.
export function pushPcm(state: PcmAccumulatorState, frame: Buffer): PushPcmResult {
  const combined = Buffer.concat([state.buffered, frame])
  if (combined.length < state.windowBytes) {
    return { state: { ...state, buffered: combined }, window: null }
  }
  const window = combined.subarray(0, state.windowBytes)
  const retained = Buffer.from(combined.subarray(state.windowBytes - state.overlapBytes))
  return {
    state: { ...state, buffered: retained },
    window: Buffer.from(window)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/pcm-accumulator.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/pcm-accumulator.ts tests/main/transcription/pcm-accumulator.test.ts
git commit -m "feat: add rolling-window PCM accumulator"
```

---

## Task 5: WAV encoder

**Files:**
- Create: `src/main/transcription/wav-encoder.ts`
- Test: `tests/main/transcription/wav-encoder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/wav-encoder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { encodeWav } from '../../../src/main/transcription/wav-encoder'

describe('encodeWav', () => {
  it('prefixes a 44-byte header before the PCM payload', () => {
    const pcm = Buffer.alloc(32_000, 7)
    const wav = encodeWav(pcm, 16_000)
    expect(wav.length).toBe(44 + pcm.length)
  })

  it('writes the RIFF and WAVE magic markers', () => {
    const wav = encodeWav(Buffer.alloc(4, 1), 16_000)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.toString('ascii', 36, 40)).toBe('data')
  })

  it('encodes 16 kHz mono 16-bit PCM in the fmt chunk', () => {
    const wav = encodeWav(Buffer.alloc(8, 1), 16_000)
    expect(wav.readUInt16LE(20)).toBe(1) // audio format: PCM
    expect(wav.readUInt16LE(22)).toBe(1) // channels: mono
    expect(wav.readUInt32LE(24)).toBe(16_000) // sample rate
    expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
  })

  it('writes the correct data chunk size', () => {
    const pcm = Buffer.alloc(100, 3)
    const wav = encodeWav(pcm, 16_000)
    expect(wav.readUInt32LE(40)).toBe(100)
  })

  it('writes the correct RIFF chunk size', () => {
    const pcm = Buffer.alloc(100, 3)
    const wav = encodeWav(pcm, 16_000)
    expect(wav.readUInt32LE(4)).toBe(36 + 100)
  })

  it('writes the correct byte rate and block align', () => {
    const wav = encodeWav(Buffer.alloc(8, 1), 16_000)
    expect(wav.readUInt32LE(28)).toBe(16_000 * 2) // byte rate: rate * blockAlign
    expect(wav.readUInt16LE(32)).toBe(2) // block align: channels * bytesPerSample
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/wav-encoder.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/wav-encoder'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/wav-encoder.ts`:

```typescript
// Wraps signed 16-bit little-endian mono PCM in a canonical 44-byte WAV
// header. whisper-cli only accepts 16-bit WAV input, so every rolling window
// is encoded here before being written to disk. Pure: returns a new Buffer.
export function encodeWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // audio format: PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcm])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/wav-encoder.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/wav-encoder.ts tests/main/transcription/wav-encoder.test.ts
git commit -m "feat: add 16 kHz mono WAV encoder for whisper input"
```

---

## Task 6: Whisper JSON output parser

**Files:**
- Create: `src/main/transcription/whisper-json-parser.ts`
- Create: `tests/fixtures/whisper/sample-output.json`
- Test: `tests/main/transcription/whisper-json-parser.test.ts`

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/whisper/sample-output.json` with a captured whisper.cpp output shape:

```json
{
  "systeminfo": "AVX = 0 | NEON = 1 | METAL = 1",
  "model": { "type": "base", "multilingual": false },
  "params": { "model": "ggml-base.en.bin", "language": "en", "translate": false },
  "result": { "language": "en" },
  "transcription": [
    {
      "timestamps": { "from": "00:00:00,000", "to": "00:00:02,400" },
      "offsets": { "from": 0, "to": 2400 },
      "text": " Hello and welcome to the meeting."
    },
    {
      "timestamps": { "from": "00:00:02,400", "to": "00:00:05,000" },
      "offsets": { "from": 2400, "to": 5000 },
      "text": " Let us get started."
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/transcription/whisper-json-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWhisperJson } from '../../../src/main/transcription/whisper-json-parser'

const FIXTURE = join(__dirname, '../../fixtures/whisper/sample-output.json')

describe('parseWhisperJson', () => {
  it('returns the joined trimmed text of every transcription segment', () => {
    const raw = readFileSync(FIXTURE, 'utf8')
    const result = parseWhisperJson(raw)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('Hello and welcome to the meeting. Let us get started.')
  })

  it('returns ok with empty text when the transcription array is empty', () => {
    const result = parseWhisperJson('{"transcription": []}')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('')
  })

  it('returns not-ok for invalid JSON', () => {
    const result = parseWhisperJson('not json')
    expect(result.ok).toBe(false)
    expect(result.text).toBe('')
  })

  it('returns not-ok when there is no transcription array', () => {
    const result = parseWhisperJson('{"model": {}}')
    expect(result.ok).toBe(false)
  })

  it('skips segments whose text is not a string', () => {
    const raw = '{"transcription": [{"text": "kept"}, {"text": 42}, {"text": " also kept"}]}'
    const result = parseWhisperJson(raw)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('kept also kept')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/whisper-json-parser.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/whisper-json-parser'`.

- [ ] **Step 4: Write the implementation**

Create `src/main/transcription/whisper-json-parser.ts`:

```typescript
export interface WhisperJsonResult {
  ok: boolean
  /** The joined, trimmed transcript text for the window. */
  text: string
}

// Parses the JSON file written by `whisper-cli --output-json`. The file shape
// is { "transcription": [ { "text": "<segment>", ... }, ... ] }. Each segment
// text is leading-space padded by whisper, so segments are trimmed and joined
// with single spaces. Pure and total: never throws.
export function parseWhisperJson(raw: string): WhisperJsonResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, text: '' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, text: '' }
  }
  const transcription = (parsed as Record<string, unknown>).transcription
  if (!Array.isArray(transcription)) {
    return { ok: false, text: '' }
  }
  const parts: string[] = []
  for (const segment of transcription) {
    if (segment && typeof segment === 'object') {
      const text = (segment as Record<string, unknown>).text
      if (typeof text === 'string') {
        const trimmed = text.trim()
        if (trimmed.length > 0) parts.push(trimmed)
      }
    }
  }
  return { ok: true, text: parts.join(' ') }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/whisper-json-parser.test.ts`
Expected: PASS, 5 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/main/transcription/whisper-json-parser.ts tests/main/transcription/whisper-json-parser.test.ts tests/fixtures/whisper/sample-output.json
git commit -m "feat: add whisper-cli JSON output parser"
```

---

## Task 7: Overlap de-duplicator

**Files:**
- Create: `src/main/transcription/overlap-dedup.ts`
- Test: `tests/main/transcription/overlap-dedup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/overlap-dedup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { dedupOverlap } from '../../../src/main/transcription/overlap-dedup'

describe('dedupOverlap', () => {
  it('returns the whole new text when there is no previous text', () => {
    expect(dedupOverlap('', 'hello there friend')).toBe('hello there friend')
  })

  it('drops a trailing-leading word overlap between consecutive windows', () => {
    const previous = 'welcome to the meeting today'
    const next = 'the meeting today we will discuss the budget'
    expect(dedupOverlap(previous, next)).toBe('we will discuss the budget')
  })

  it('returns an empty string when the new text is fully contained in the previous tail', () => {
    expect(dedupOverlap('one two three four', 'three four')).toBe('')
  })

  it('returns the whole new text when there is no shared overlap', () => {
    expect(dedupOverlap('completely different words', 'nothing matches here')).toBe(
      'nothing matches here'
    )
  })

  it('matches the longest overlap, not a shorter accidental one', () => {
    const previous = 'the cat sat on the mat'
    const next = 'on the mat and then it slept'
    expect(dedupOverlap(previous, next)).toBe('and then it slept')
  })

  it('is case-insensitive and whitespace-tolerant when matching the overlap', () => {
    const previous = 'Discuss the Quarterly Budget'
    const next = 'the quarterly budget   in detail'
    expect(dedupOverlap(previous, next)).toBe('in detail')
  })

  it('returns an empty string when next is empty', () => {
    expect(dedupOverlap('anything here', '')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/overlap-dedup.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/overlap-dedup'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/overlap-dedup.ts`:

```typescript
// Removes the duplicated region where two consecutive overlapping whisper
// windows say the same words. Windows overlap by 2 s of audio, so the start
// of `next` repeats the end of `previous`. This finds the longest run of
// words at the end of `previous` that also begins `next`, and returns only
// the genuinely new words. Pure: matching is case-insensitive on tokenized
// words; the returned text preserves the original `next` casing and spacing.
export function dedupOverlap(previous: string, next: string): string {
  const nextWords = next.trim().split(/\s+/).filter((w) => w.length > 0)
  if (nextWords.length === 0) return ''

  const prevWords = previous.trim().split(/\s+/).filter((w) => w.length > 0)
  if (prevWords.length === 0) return nextWords.join(' ')

  const lower = (words: string[]): string[] => words.map((w) => w.toLowerCase())
  const prevLower = lower(prevWords)
  const nextLower = lower(nextWords)

  const maxOverlap = Math.min(prevLower.length, nextLower.length)
  let overlap = 0
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const prevTail = prevLower.slice(prevLower.length - size).join(' ')
    const nextHead = nextLower.slice(0, size).join(' ')
    if (prevTail === nextHead) {
      overlap = size
      break
    }
  }

  return nextWords.slice(overlap).join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/overlap-dedup.test.ts`
Expected: PASS, 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/overlap-dedup.ts tests/main/transcription/overlap-dedup.test.ts
git commit -m "feat: add overlapping-window transcript de-duplicator"
```

---

## Task 8: Immutable transcript buffer

**Files:**
- Create: `src/main/transcription/transcript-buffer.ts`
- Test: `tests/main/transcription/transcript-buffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/transcript-buffer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  createTranscriptBuffer,
  appendSegment,
  readSegments,
  type TranscriptBuffer
} from '../../../src/main/transcription/transcript-buffer'

describe('transcript-buffer', () => {
  it('starts empty', () => {
    const buffer = createTranscriptBuffer()
    expect(readSegments(buffer)).toEqual([])
  })

  it('appends a segment with a generated id, the speaker, and the text', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'hello world')
    const segments = readSegments(buffer)
    expect(segments).toHaveLength(1)
    expect(segments[0].speaker).toBe('you')
    expect(segments[0].text).toBe('hello world')
    expect(segments[0].id.length).toBeGreaterThan(0)
  })

  it('gives every appended segment a unique id', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'one')
    buffer = appendSegment(buffer, 'them', 'two')
    const segments = readSegments(buffer)
    expect(segments[0].id).not.toBe(segments[1].id)
  })

  it('preserves append order', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'first')
    buffer = appendSegment(buffer, 'you', 'second')
    buffer = appendSegment(buffer, 'them', 'third')
    expect(readSegments(buffer).map((s) => s.text)).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate the input buffer when appending', () => {
    const original = createTranscriptBuffer()
    appendSegment(original, 'you', 'ignored')
    expect(readSegments(original)).toEqual([])
  })

  it('returns a defensive copy from readSegments', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'safe')
    const first = readSegments(buffer)
    first.push({ id: 'x', speaker: 'them', text: 'injected' })
    expect(readSegments(buffer)).toHaveLength(1)
  })

  it('ignores an empty-text append and returns the same content', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', '   ')
    expect(readSegments(buffer)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/transcript-buffer.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/transcript-buffer'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/transcript-buffer.ts`:

```typescript
import { randomUUID } from 'node:crypto'
import type { TranscriptSegment } from '../../shared/types'

export interface TranscriptBuffer {
  readonly segments: readonly TranscriptSegment[]
}

// Creates an empty rolling transcript buffer.
export function createTranscriptBuffer(): TranscriptBuffer {
  return { segments: [] }
}

// Appends one transcript segment. The speaker hint is 'you' for microphone
// audio and 'them' for system audio (system audio arrives in Phase 4).
// Immutable: returns a new buffer and never mutates the input. Empty or
// whitespace-only text is ignored so silent windows add nothing.
export function appendSegment(
  buffer: TranscriptBuffer,
  speaker: TranscriptSegment['speaker'],
  text: string
): TranscriptBuffer {
  const trimmed = text.trim()
  if (trimmed.length === 0) return buffer
  const segment: TranscriptSegment = { id: randomUUID(), speaker, text: trimmed }
  return { segments: [...buffer.segments, segment] }
}

// Reads all segments in append order as a defensive mutable copy.
export function readSegments(buffer: TranscriptBuffer): TranscriptSegment[] {
  return buffer.segments.map((segment) => ({ ...segment }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/transcript-buffer.test.ts`
Expected: PASS, 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/transcript-buffer.ts tests/main/transcription/transcript-buffer.test.ts
git commit -m "feat: add immutable rolling transcript buffer"
```

---

## Task 9: Whisper runner (subprocess)

**Files:**
- Create: `src/main/transcription/whisper-runner.ts`
- Create: `tests/fixtures/whisper/mock-whisper-ok.mjs`
- Create: `tests/fixtures/whisper/mock-whisper-fail.mjs`
- Create: `tests/fixtures/whisper/mock-whisper-hang.mjs`
- Test: `tests/main/transcription/whisper-runner.test.ts`

- [ ] **Step 1: Create the mock `whisper-cli` (success) fixture**

Create `tests/fixtures/whisper/mock-whisper-ok.mjs`:

```javascript
// Mock `whisper-cli`: reads the -f input path, writes `<input>.json` with a
// valid transcription array, prints a result line to stdout, exits 0.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('-f')
const inputPath = fileIdx >= 0 ? args[fileIdx + 1] : null

if (inputPath) {
  const json = {
    transcription: [
      { offsets: { from: 0, to: 2000 }, text: ' This is a mock transcription.' }
    ]
  }
  writeFileSync(`${inputPath}.json`, JSON.stringify(json))
}
process.stdout.write('This is a mock transcription.\n')
process.exit(0)
```

- [ ] **Step 2: Create the mock `whisper-cli` (failure) fixture**

Create `tests/fixtures/whisper/mock-whisper-fail.mjs`:

```javascript
// Mock `whisper-cli` failure: writes a leaky absolute path to stderr and
// exits 1, so the runner test can confirm stderr never reaches user-facing
// errors.
process.stderr.write('whisper: failed to load model /Users/secret/leaked/model.bin\n')
process.exit(1)
```

- [ ] **Step 2b: Create the mock `whisper-cli` (hang) fixture**

Create `tests/fixtures/whisper/mock-whisper-hang.mjs`:

```javascript
// Mock `whisper-cli` that never exits, to exercise the runner timeout.
setInterval(() => {}, 1000)
```

- [ ] **Step 3: Write the failing test**

Create `tests/main/transcription/whisper-runner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runWhisper } from '../../../src/main/transcription/whisper-runner'

const FIXTURES = join(__dirname, '../../fixtures/whisper')

function scratchWav(): string {
  const dir = mkdtempSync(join(tmpdir(), 'whisper-runner-'))
  const wavPath = join(dir, 'window.wav')
  writeFileSync(wavPath, Buffer.alloc(64, 0))
  return wavPath
}

describe('runWhisper', () => {
  it('resolves with parsed transcript text on a successful run', async () => {
    const wavPath = scratchWav()
    const result = await runWhisper({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-whisper-ok.mjs')],
      modelPath: '/fake/model.bin',
      wavPath,
      timeoutMs: 5000
    })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('This is a mock transcription.')
  })

  it('resolves not-ok when whisper exits non-zero and keeps stderr out of error', async () => {
    const wavPath = scratchWav()
    const result = await runWhisper({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-whisper-fail.mjs')],
      modelPath: '/fake/model.bin',
      wavPath,
      timeoutMs: 5000
    })
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('/Users/secret/leaked/model.bin')
    expect(result.diagnostic).toContain('/Users/secret/leaked/model.bin')
  })

  it('resolves not-ok with a timeout message when whisper hangs', async () => {
    const wavPath = scratchWav()
    const result = await runWhisper({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-whisper-hang.mjs')],
      modelPath: '/fake/model.bin',
      wavPath,
      timeoutMs: 300
    })
    expect(result.ok).toBe(false)
    expect(result.error.toLowerCase()).toContain('timed out')
  })

  it('resolves not-ok when the command cannot be spawned', async () => {
    const result = await runWhisper({
      command: 'definitely-not-a-real-binary-xyz',
      prefixArgs: [],
      modelPath: '/fake/model.bin',
      wavPath: '/tmp/none.wav',
      timeoutMs: 2000
    })
    expect(result.ok).toBe(false)
    expect(result.error.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/whisper-runner.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/whisper-runner'`.

- [ ] **Step 5: Write the implementation**

Create `src/main/transcription/whisper-runner.ts`:

```typescript
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { parseWhisperJson } from './whisper-json-parser'

export interface RunWhisperInput {
  /** The whisper-cli binary, or `node` in tests. */
  command: string
  /** Args inserted before whisper's own flags (the mock script path in tests). */
  prefixArgs: string[]
  /** Absolute path to the ggml model file. */
  modelPath: string
  /** Absolute path to the 16 kHz mono WAV window to transcribe. */
  wavPath: string
  /** Hard timeout for the subprocess. */
  timeoutMs: number
}

export interface RunWhisperResult {
  ok: boolean
  /** Parsed transcript text for the window; empty on failure. */
  text: string
  /**
   * Internal-only detail (raw stderr). NEVER emit to the renderer: it can
   * contain absolute filesystem paths. Always present; empty when nothing.
   */
  diagnostic: string
  /** Generic user-facing error message; never contains raw stderr. */
  error: string
}

// Spawns `whisper-cli` on one WAV window and returns its transcript. whisper
// writes its result to `<wavPath>.json` because of the --output-json flag;
// the runner reads and parses that file, then deletes it. Mirrors the proven
// codex-runner.ts shape: a single Promise, a timeout, an error handler bound
// before the stdio streams, and raw stderr kept out of the user-facing error.
export function runWhisper(input: RunWhisperInput): Promise<RunWhisperResult> {
  return new Promise((resolve) => {
    const jsonPath = `${input.wavPath}.json`
    const args = [
      ...input.prefixArgs,
      '-m',
      input.modelPath,
      '-f',
      input.wavPath,
      '-l',
      'en',
      '-oj',
      '-nt',
      '-np'
    ]
    const child = spawn(input.command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    let settled = false

    const finish = (result: RunWhisperResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void rm(jsonPath, { force: true }).catch(() => {})
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        ok: false,
        text: '',
        diagnostic: '',
        error: `Transcription timed out after ${input.timeoutMs} ms.`
      })
    }, input.timeoutMs)

    // Bind the error handler before touching stdio: on a spawn failure the
    // streams can be null and the failure arrives through this event.
    child.on('error', (err: Error) => {
      finish({
        ok: false,
        text: '',
        diagnostic: '',
        error: `Failed to start whisper-cli: ${err.message}`
      })
    })

    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        finish({
          ok: false,
          text: '',
          diagnostic: stderr.trim(),
          error: `Transcription failed (exit code ${code}).`
        })
        return
      }
      readFile(jsonPath, 'utf8')
        .then((raw) => {
          const parsed = parseWhisperJson(raw)
          if (!parsed.ok) {
            finish({
              ok: false,
              text: '',
              diagnostic: 'whisper produced unreadable JSON output.',
              error: 'Transcription produced no readable output.'
            })
            return
          }
          finish({ ok: true, text: parsed.text, diagnostic: '', error: '' })
        })
        .catch(() => {
          finish({
            ok: false,
            text: '',
            diagnostic: 'whisper JSON output file was missing.',
            error: 'Transcription produced no output.'
          })
        })
    })
  })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/whisper-runner.test.ts`
Expected: PASS, 4 cases green.

- [ ] **Step 7: Commit**

```bash
git add src/main/transcription/whisper-runner.ts tests/main/transcription/whisper-runner.test.ts tests/fixtures/whisper/mock-whisper-ok.mjs tests/fixtures/whisper/mock-whisper-fail.mjs tests/fixtures/whisper/mock-whisper-hang.mjs
git commit -m "feat: add whisper-cli subprocess runner"
```

---

## Task 10: Transcription service (orchestrator)

**Files:**
- Create: `src/main/transcription/transcription-service.ts`
- Test: `tests/main/transcription/transcription-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/transcription-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createTranscriptionService } from '../../../src/main/transcription/transcription-service'
import { IpcChannel } from '../../../src/shared/types'

// A 1-second mono 16 kHz 16-bit PCM frame is 32000 bytes. An 8 s window is
// 256000 bytes, so 8 frames produce exactly one window.
function frameBase64(): string {
  return Buffer.alloc(32_000, 1).toString('base64')
}

function makeDeps(runWhisper: ReturnType<typeof vi.fn>) {
  return {
    emit: vi.fn(),
    runWhisper,
    modelPath: '/fake/model.bin'
  }
}

describe('createTranscriptionService', () => {
  it('does not run whisper before a full window is buffered', async () => {
    const runWhisper = vi.fn()
    const service = createTranscriptionService(makeDeps(runWhisper))
    await service.handleAudioFrame({ pcmBase64: frameBase64() })
    expect(runWhisper).not.toHaveBeenCalled()
  })

  it('runs whisper once a full 8-second window is buffered', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const service = createTranscriptionService(makeDeps(runWhisper))
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('emits a TranscriptUpdate with the appended segment after a window transcribes', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    expect(updateCall).toBeDefined()
    const payload = updateCall![1] as { segments: { speaker: string; text: string }[] }
    expect(payload.segments).toHaveLength(1)
    expect(payload.segments[0].speaker).toBe('you')
    expect(payload.segments[0].text).toBe('hello world')
  })

  it('de-duplicates the overlap between consecutive windows before appending', async () => {
    const runWhisper = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: 'the meeting starts now', diagnostic: '', error: '' })
      .mockResolvedValueOnce({ ok: true, text: 'starts now and runs long', diagnostic: '', error: '' })
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 16; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    const updates = deps.emit.mock.calls.filter((c) => c[0] === IpcChannel.TranscriptUpdate)
    const last = updates[updates.length - 1][1] as { segments: { text: string }[] }
    expect(last.segments.map((s) => s.text)).toEqual(['the meeting starts now', 'and runs long'])
  })

  it('does not append a segment when whisper fails for a window', async () => {
    const runWhisper = vi.fn(async () => ({
      ok: false,
      text: '',
      diagnostic: 'leaky path',
      error: 'Transcription failed.'
    }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    const updates = deps.emit.mock.calls.filter((c) => c[0] === IpcChannel.TranscriptUpdate)
    expect(updates).toHaveLength(0)
  })

  it('reset clears the buffer and the accumulator', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    service.reset()
    deps.emit.mockClear()
    for (let i = 0; i < 7; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    expect(runWhisper).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/transcription/transcription-service.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/transcription-service'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/transcription-service.ts`:

```typescript
import { join } from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { WHISPER } from '../config/constants'
import { IpcChannel, type AudioFramePayload } from '../../shared/types'
import {
  createPcmAccumulator,
  pushPcm,
  type PcmAccumulatorState
} from './pcm-accumulator'
import {
  createTranscriptBuffer,
  appendSegment,
  readSegments,
  type TranscriptBuffer
} from './transcript-buffer'
import { encodeWav } from './wav-encoder'
import { dedupOverlap } from './overlap-dedup'
import type { RunWhisperResult } from './whisper-runner'

// 16-bit mono PCM is 2 bytes per sample. Window and overlap byte sizes are
// derived once from the WHISPER timing constants.
const BYTES_PER_SECOND = WHISPER.sampleRate * 2
const WINDOW_BYTES = WHISPER.windowSeconds * BYTES_PER_SECOND
const OVERLAP_BYTES = WHISPER.overlapSeconds * BYTES_PER_SECOND

export interface TranscriptionServiceDeps {
  /** Sends an IPC payload to the renderer. */
  emit: (channel: string, payload: unknown) => void
  /** Runs whisper-cli on one WAV window. Injected for testing. */
  runWhisper: (input: {
    command: string
    prefixArgs: string[]
    modelPath: string
    wavPath: string
    timeoutMs: number
  }) => Promise<RunWhisperResult>
  /** Absolute path to the ggml model file. */
  modelPath: string
  /** The whisper-cli binary path; defaults to WHISPER.binaryName. */
  command?: string
}

export interface TranscriptionService {
  /** Accepts one PCM frame from the renderer. */
  handleAudioFrame: (payload: unknown) => Promise<void>
  /** Clears all transcript state, for a new session. */
  reset: () => void
}

function pcmOf(payload: unknown): Buffer | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).pcmBase64
    if (typeof value === 'string' && value.length > 0) {
      return Buffer.from(value, 'base64')
    }
  }
  return null
}

// Orchestrates microphone transcription. It accumulates PCM frames into
// rolling 8 s windows (2 s overlap), runs whisper on each completed window,
// de-duplicates the overlap against the previous window's text, appends the
// new text to the immutable transcript buffer, and emits the full transcript
// to the renderer. Mirrors codex-service.ts: a single-flight guard ensures
// only one whisper subprocess runs at a time.
export function createTranscriptionService(
  deps: TranscriptionServiceDeps
): TranscriptionService {
  let accumulator: PcmAccumulatorState = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
  let buffer: TranscriptBuffer = createTranscriptBuffer()
  let previousWindowText = ''
  let inFlight = false

  async function transcribeWindow(window: Buffer): Promise<void> {
    const scratchRoot = join(tmpdir(), WHISPER.scratchDirName)
    const wavPath = join(scratchRoot, `window-${randomUUID()}.wav`)
    try {
      await mkdir(scratchRoot, { recursive: true })
      await writeFile(wavPath, encodeWav(window, WHISPER.sampleRate))
      const result = await deps.runWhisper({
        command: deps.command ?? WHISPER.binaryName,
        prefixArgs: [],
        modelPath: deps.modelPath,
        wavPath,
        timeoutMs: WHISPER.timeoutMs
      })
      if (result.ok && result.text.length > 0) {
        const fresh = dedupOverlap(previousWindowText, result.text)
        previousWindowText = result.text
        if (fresh.length > 0) {
          buffer = appendSegment(buffer, 'you', fresh)
          deps.emit(IpcChannel.TranscriptUpdate, { segments: readSegments(buffer) })
        }
      }
    } finally {
      await rm(wavPath, { force: true }).catch(() => {})
    }
  }

  async function handleAudioFrame(payload: unknown): Promise<void> {
    const pcm = pcmOf(payload)
    if (pcm === null) return
    const pushed = pushPcm(accumulator, pcm)
    accumulator = pushed.state
    if (pushed.window === null) return
    // Single-flight: drop windows that arrive while whisper is still running
    // so the subprocess never queues up under load.
    if (inFlight) return
    inFlight = true
    try {
      await transcribeWindow(pushed.window)
    } finally {
      inFlight = false
    }
  }

  function reset(): void {
    accumulator = createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES)
    buffer = createTranscriptBuffer()
    previousWindowText = ''
  }

  return { handleAudioFrame, reset }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/transcription/transcription-service.test.ts`
Expected: PASS, 7 cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/transcription/transcription-service.ts tests/main/transcription/transcription-service.test.ts
git commit -m "feat: add transcription service orchestrating windowed whisper"
```

---

## Task 11: IPC handlers for transcription

**Files:**
- Modify: `src/main/ipc/ipc-handlers.ts`
- Modify: `tests/main/ipc/ipc-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/main/ipc/ipc-handlers.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

function makeDeps() {
  return {
    onToggleInvisibility: vi.fn(),
    onAskQuestion: vi.fn(),
    onStartTranscription: vi.fn(),
    onStopTranscription: vi.fn(),
    onAudioFrame: vi.fn()
  }
}

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('forwards the request payload when the AskQuestion channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-1', question: 'hello' }
    handlers[IpcChannel.AskQuestion]({}, request)
    expect(deps.onAskQuestion).toHaveBeenCalledWith(request)
  })

  it('calls onStartTranscription when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StartTranscription]()
    expect(deps.onStartTranscription).toHaveBeenCalledOnce()
  })

  it('calls onStopTranscription when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StopTranscription]()
    expect(deps.onStopTranscription).toHaveBeenCalledOnce()
  })

  it('forwards the audio frame payload when the AudioFrame channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      })
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const frame = { pcmBase64: 'AAAA' }
    handlers[IpcChannel.AudioFrame]({}, frame)
    expect(deps.onAudioFrame).toHaveBeenCalledWith(frame)
  })

  it('registers exactly five channel handlers', () => {
    const ipcMain = { on: vi.fn() }
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledTimes(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/main/ipc/ipc-handlers.test.ts`
Expected: FAIL: `registers exactly five channel handlers` expects 5 but receives 2, and the transcription handler cases fail because `handlers[IpcChannel.StartTranscription]` is `undefined`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/main/ipc/ipc-handlers.ts` with:

```typescript
import { IpcChannel } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
  onAskQuestion(request: unknown): void
  onStartTranscription(): void
  onStopTranscription(): void
  onAudioFrame(frame: unknown): void
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1])
  })
  ipcMain.on(IpcChannel.StartTranscription, () => deps.onStartTranscription())
  ipcMain.on(IpcChannel.StopTranscription, () => deps.onStopTranscription())
  ipcMain.on(IpcChannel.AudioFrame, (...args: unknown[]) => {
    deps.onAudioFrame(args[1])
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/main/ipc/ipc-handlers.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/ipc-handlers.ts tests/main/ipc/ipc-handlers.test.ts
git commit -m "feat: register transcription IPC channels"
```

---

## Task 12: Preload API for transcription

**Files:**
- Modify: `src/preload/api.ts`
- Test: `tests/preload/api.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `tests/preload/api.test.ts` (keep all existing imports and cases; add `AudioFramePayload`, `TranscriptUpdatePayload`, and `TranscriptionStatusPayload` to the type import from `'../../src/shared/types'` if a type import is present, otherwise import them where the file imports shared types):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createOverlayApi, type IpcRendererLike } from '../../src/preload/api'
import { IpcChannel } from '../../src/shared/types'

describe('createOverlayApi transcription methods', () => {
  function makeIpc(): IpcRendererLike & {
    sent: { channel: string; args: unknown[] }[]
    listeners: Record<string, (e: unknown, p: unknown) => void>
  } {
    const sent: { channel: string; args: unknown[] }[] = []
    const listeners: Record<string, (e: unknown, p: unknown) => void> = {}
    return {
      sent,
      listeners,
      send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
      on: (channel: string, listener: (...a: unknown[]) => void) => {
        listeners[channel] = listener as (e: unknown, p: unknown) => void
      },
      removeListener: () => {}
    }
  }

  it('startTranscription sends on the StartTranscription channel', () => {
    const ipc = makeIpc()
    createOverlayApi(ipc).startTranscription()
    expect(ipc.sent[0].channel).toBe(IpcChannel.StartTranscription)
  })

  it('stopTranscription sends on the StopTranscription channel', () => {
    const ipc = makeIpc()
    createOverlayApi(ipc).stopTranscription()
    expect(ipc.sent[0].channel).toBe(IpcChannel.StopTranscription)
  })

  it('sendAudioFrame sends the frame payload on the AudioFrame channel', () => {
    const ipc = makeIpc()
    createOverlayApi(ipc).sendAudioFrame({ pcmBase64: 'AAAA' })
    expect(ipc.sent[0].channel).toBe(IpcChannel.AudioFrame)
    expect(ipc.sent[0].args[0]).toEqual({ pcmBase64: 'AAAA' })
  })

  it('onTranscriptUpdate subscribes to the TranscriptUpdate channel', () => {
    const ipc = makeIpc()
    const received: unknown[] = []
    createOverlayApi(ipc).onTranscriptUpdate((payload) => received.push(payload))
    ipc.listeners[IpcChannel.TranscriptUpdate]({}, { segments: [] })
    expect(received).toEqual([{ segments: [] }])
  })

  it('onTranscriptionStatus subscribes to the TranscriptionStatus channel', () => {
    const ipc = makeIpc()
    const received: unknown[] = []
    createOverlayApi(ipc).onTranscriptionStatus((payload) => received.push(payload))
    ipc.listeners[IpcChannel.TranscriptionStatus]({}, { ready: true, detail: 'ok' })
    expect(received).toEqual([{ ready: true, detail: 'ok' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/preload/api.test.ts`
Expected: FAIL: `startTranscription` is not a function on the returned API and the other new methods are missing.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/preload/api.ts` with:

```typescript
import {
  IpcChannel,
  type OverlayState,
  type AskQuestionRequest,
  type AnswerChunk,
  type AnswerResult,
  type AnswerError,
  type CodexStatus,
  type AudioFramePayload,
  type TranscriptUpdatePayload,
  type TranscriptionStatusPayload
} from '../shared/types'

export interface IpcRendererLike {
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: unknown[]) => void): void
  removeListener?(channel: string, listener: (...args: unknown[]) => void): void
}

export interface OverlayApi {
  toggleInvisibility(): void
  onOverlayState(callback: (state: OverlayState) => void): () => void
  askQuestion(request: AskQuestionRequest): void
  onAnswerChunk(callback: (chunk: AnswerChunk) => void): () => void
  onAnswerDone(callback: (result: AnswerResult) => void): () => void
  onAnswerError(callback: (error: AnswerError) => void): () => void
  onCodexStatus(callback: (status: CodexStatus) => void): () => void
  startTranscription(): void
  stopTranscription(): void
  sendAudioFrame(frame: AudioFramePayload): void
  onTranscriptUpdate(callback: (update: TranscriptUpdatePayload) => void): () => void
  onTranscriptionStatus(callback: (status: TranscriptionStatusPayload) => void): () => void
}

export function createOverlayApi(ipcRenderer: IpcRendererLike): OverlayApi {
  function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
    const listener = (_event: unknown, payload: T): void => callback(payload)
    ipcRenderer.on(channel, listener as (...args: unknown[]) => void)
    return () => ipcRenderer.removeListener?.(channel, listener as (...args: unknown[]) => void)
  }
  return {
    toggleInvisibility: () => ipcRenderer.send(IpcChannel.ToggleInvisibility),
    onOverlayState: (callback) => subscribe(IpcChannel.OverlayState, callback),
    askQuestion: (request) => ipcRenderer.send(IpcChannel.AskQuestion, request),
    onAnswerChunk: (callback) => subscribe(IpcChannel.AnswerChunk, callback),
    onAnswerDone: (callback) => subscribe(IpcChannel.AnswerDone, callback),
    onAnswerError: (callback) => subscribe(IpcChannel.AnswerError, callback),
    onCodexStatus: (callback) => subscribe(IpcChannel.CodexStatus, callback),
    startTranscription: () => ipcRenderer.send(IpcChannel.StartTranscription),
    stopTranscription: () => ipcRenderer.send(IpcChannel.StopTranscription),
    sendAudioFrame: (frame) => ipcRenderer.send(IpcChannel.AudioFrame, frame),
    onTranscriptUpdate: (callback) => subscribe(IpcChannel.TranscriptUpdate, callback),
    onTranscriptionStatus: (callback) => subscribe(IpcChannel.TranscriptionStatus, callback)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/preload/api.test.ts`
Expected: PASS, all cases green (the original cases plus the 5 new ones).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/preload/api.ts tests/preload/api.test.ts
git commit -m "feat: expose transcription methods on the preload overlay API"
```

---

## Task 13: Renderer audio downsampler

**Files:**
- Create: `src/renderer/src/audio/downsample.ts`
- Test: `tests/renderer/audio/downsample.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/audio/downsample.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { downsampleTo16k, floatToInt16Pcm } from '../../../src/renderer/src/audio/downsample'

describe('downsampleTo16k', () => {
  it('returns the input unchanged when the source rate is already 16 kHz', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1])
    const output = downsampleTo16k(input, 16_000)
    expect(Array.from(output)).toEqual([0, 0.5, -0.5, 1])
  })

  it('halves the sample count when downsampling 32 kHz to 16 kHz', () => {
    const input = new Float32Array(32)
    const output = downsampleTo16k(input, 32_000)
    expect(output.length).toBe(16)
  })

  it('produces roughly a third of the samples when downsampling 48 kHz to 16 kHz', () => {
    const input = new Float32Array(48_000)
    const output = downsampleTo16k(input, 48_000)
    expect(output.length).toBe(16_000)
  })

  it('keeps the first sample when downsampling', () => {
    const input = new Float32Array([0.9, 0.1, 0.8, 0.2])
    const output = downsampleTo16k(input, 32_000)
    expect(output[0]).toBeCloseTo(0.9, 5)
  })
})

describe('floatToInt16Pcm', () => {
  it('converts 0 to 0', () => {
    const pcm = floatToInt16Pcm(new Float32Array([0]))
    expect(pcm.readInt16LE(0)).toBe(0)
  })

  it('converts 1 to the positive 16-bit maximum 32767', () => {
    const pcm = floatToInt16Pcm(new Float32Array([1]))
    expect(pcm.readInt16LE(0)).toBe(32_767)
  })

  it('converts -1 to -32767', () => {
    const pcm = floatToInt16Pcm(new Float32Array([-1]))
    expect(pcm.readInt16LE(0)).toBe(-32_767)
  })

  it('clamps values above 1 and below -1', () => {
    const pcm = floatToInt16Pcm(new Float32Array([2, -2]))
    expect(pcm.readInt16LE(0)).toBe(32_767)
    expect(pcm.readInt16LE(2)).toBe(-32_767)
  })

  it('produces 2 bytes per sample', () => {
    const pcm = floatToInt16Pcm(new Float32Array([0, 0.5, -0.5]))
    expect(pcm.length).toBe(6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/renderer/audio/downsample.test.ts`
Expected: FAIL with `Cannot find module '../../../src/renderer/src/audio/downsample'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/audio/downsample.ts`:

```typescript
// Pure audio conversion helpers for the microphone capture path. The browser
// AudioContext typically runs at 44.1 or 48 kHz, but whisper.cpp requires
// 16 kHz mono. These functions have no DOM dependency and are fully tested.

// Downsamples a Float32 mono block from `sourceRate` to 16 kHz by nearest-
// sample picking. Nearest-sample (decimation) is sufficient here: whisper is
// robust to mild aliasing and this keeps the renderer hot path cheap.
export function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  const targetRate = 16_000
  if (sourceRate === targetRate) return input
  const ratio = sourceRate / targetRate
  const outLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    output[i] = input[Math.floor(i * ratio)]
  }
  return output
}

// Converts a Float32 block in [-1, 1] to signed 16-bit little-endian PCM.
// Values are clamped, then scaled by 32767 so full-scale audio maps to the
// 16-bit range without overflow.
export function floatToInt16Pcm(input: Float32Array): Buffer {
  const pcm = Buffer.alloc(input.length * 2)
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]))
    pcm.writeInt16LE(Math.round(clamped * 32_767), i * 2)
  }
  return pcm
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/renderer/audio/downsample.test.ts`
Expected: PASS, 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/audio/downsample.ts tests/renderer/audio/downsample.test.ts
git commit -m "feat: add renderer audio downsampler and PCM converter"
```

---

## Task 14: AudioWorklet processor and start/stop mic-capture seam

**Files:**
- Create: `src/renderer/src/audio/pcm-worklet.ts`
- Create: `src/renderer/src/audio/mic-capture.ts`

This task wires browser audio APIs and has no pure logic to unit-test beyond Task 13; it is verified by typecheck and by the Phase 3 manual verification (Task 18). The implementation is shown complete below. `mic-capture.ts` is an explicit start/stop seam: `startCapture()` calls `getUserMedia` (and so fires the macOS microphone permission prompt) ONLY when invoked, never on import or mount; the returned handle's `stopCapture()` releases the `MediaStream` tracks so the macOS microphone indicator turns off.

- [ ] **Step 1: Create the AudioWorklet processor source**

Create `src/renderer/src/audio/pcm-worklet.ts`:

```typescript
// The AudioWorklet processor runs on the dedicated audio thread. It cannot be
// imported normally because it executes in the AudioWorkletGlobalScope, so its
// source is exported as a string and registered via a Blob URL by mic-capture.
// The processor forwards every 128-sample render quantum of channel 0 to the
// main thread as a Float32Array; mic-capture downsamples and batches it.
export const PCM_WORKLET_NAME = 'customcluely-pcm-worklet'

export const PCM_WORKLET_SOURCE = `
class CustomcluelyPcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      this.port.postMessage(input[0].slice(0))
    }
    return true
  }
}
registerProcessor('${PCM_WORKLET_NAME}', CustomcluelyPcmWorklet)
`
```

- [ ] **Step 2: Create the start/stop mic-capture module**

Create `src/renderer/src/audio/mic-capture.ts`:

```typescript
import { downsampleTo16k, floatToInt16Pcm } from './downsample'
import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from './pcm-worklet'

// 16 kHz mono 16-bit PCM: 32000 bytes is one second of audio.
const FRAME_BYTES = 32_000

export interface MicCaptureHandle {
  /** Stops capture and releases the microphone tracks and audio graph. */
  stopCapture: () => Promise<void>
}

export interface MicCaptureCallbacks {
  /** Called with one ~1-second base64-encoded 16 kHz PCM frame. */
  onFrame: (pcmBase64: string) => void
  /** Called with a user-facing message when capture cannot start. */
  onError: (message: string) => void
}

// Starts microphone capture and delivers 16 kHz mono 16-bit PCM frames. This
// is the explicit start/stop audio-source seam and the STOPGAP capture path:
// Phase 4 replaces it with the Swift sidecar, so this module is the entire
// seam to swap.
//
// getUserMedia is called only inside this function, so the macOS microphone
// permission prompt fires only on a deliberate user action (the ListenToggle),
// never on import or app mount. The returned handle's stopCapture releases the
// MediaStream tracks, which turns the macOS microphone indicator off.
export async function startCapture(
  callbacks: MicCaptureCallbacks
): Promise<MicCaptureHandle> {
  let pending = Buffer.alloc(0)

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' })
    const workletUrl = URL.createObjectURL(blob)
    await context.audioWorklet.addModule(workletUrl)
    URL.revokeObjectURL(workletUrl)

    const source = context.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(context, PCM_WORKLET_NAME)

    worklet.port.onmessage = (event: MessageEvent<Float32Array>): void => {
      const downsampled = downsampleTo16k(event.data, context.sampleRate)
      const pcm = floatToInt16Pcm(downsampled)
      pending = Buffer.concat([pending, pcm])
      while (pending.length >= FRAME_BYTES) {
        const frame = pending.subarray(0, FRAME_BYTES)
        pending = Buffer.from(pending.subarray(FRAME_BYTES))
        callbacks.onFrame(Buffer.from(frame).toString('base64'))
      }
    }

    source.connect(worklet)
    // The worklet has no audio output; connecting it to the destination keeps
    // the graph alive without producing sound (it returns silence).
    worklet.connect(context.destination)

    const stopCapture = async (): Promise<void> => {
      worklet.port.onmessage = null
      worklet.disconnect()
      source.disconnect()
      // Stopping every track releases the microphone so the macOS mic
      // indicator turns off.
      stream.getTracks().forEach((track) => track.stop())
      await context.close()
    }
    return { stopCapture }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Microphone capture failed.'
    callbacks.onError(`Could not start microphone capture: ${message}`)
    return { stopCapture: async () => {} }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/audio/pcm-worklet.ts src/renderer/src/audio/mic-capture.ts
git commit -m "feat: add start/stop AudioWorklet mic capture seam"
```

---

## Task 15: useTranscript hook

**Files:**
- Create: `src/renderer/src/hooks/useTranscript.ts`
- Test: `tests/renderer/hooks/useTranscript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/useTranscript.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTranscript } from '../../../src/renderer/src/hooks/useTranscript'
import type { TranscriptUpdatePayload, TranscriptionStatusPayload } from '../../../src/shared/types'

type Cb<T> = (payload: T) => void

let updateCb: Cb<TranscriptUpdatePayload> = () => {}
let statusCb: Cb<TranscriptionStatusPayload> = () => {}
let started = 0
let stopped = 0
let getUserMediaCalls = 0
let trackStops = 0

// A fake MediaStream whose tracks count their stop() calls, so a test can
// confirm stopListening releases the microphone.
function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: () => { trackStops += 1 } }]
  } as unknown as MediaStream
}

beforeEach(() => {
  updateCb = () => {}
  statusCb = () => {}
  started = 0
  stopped = 0
  getUserMediaCalls = 0
  trackStops = 0
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion: vi.fn(),
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription: vi.fn(() => {
      started += 1
    }),
    stopTranscription: vi.fn(() => {
      stopped += 1
    }),
    sendAudioFrame: vi.fn(),
    onTranscriptUpdate: vi.fn((cb: Cb<TranscriptUpdatePayload>) => {
      updateCb = cb
      return () => {}
    }),
    onTranscriptionStatus: vi.fn((cb: Cb<TranscriptionStatusPayload>) => {
      statusCb = cb
      return () => {}
    })
  }
  // The AudioContext and AudioWorklet APIs are not implemented in jsdom, so
  // they are stubbed here. getUserMedia is counted to prove it is NOT called
  // on mount and IS called only on startListening.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        getUserMediaCalls += 1
        return fakeStream()
      })
    }
  })
  class FakeAudioContext {
    sampleRate = 48_000
    destination = {}
    audioWorklet = { addModule: vi.fn(async () => {}) }
    createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
      return { connect: () => {}, disconnect: () => {} }
    }
    close(): Promise<void> {
      return Promise.resolve()
    }
  }
  class FakeAudioWorkletNode {
    port: { onmessage: unknown } = { onmessage: null }
    connect(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  vi.stubGlobal('Blob', class {})
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
})

describe('useTranscript', () => {
  it('starts with no segments, not listening, and a not-ready status', () => {
    const { result } = renderHook(() => useTranscript())
    expect(result.current.segments).toEqual([])
    expect(result.current.listening).toBe(false)
    expect(result.current.ready).toBe(false)
  })

  it('does not call getUserMedia on mount', () => {
    renderHook(() => useTranscript())
    expect(getUserMediaCalls).toBe(0)
  })

  it('updates segments when a transcript update arrives', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => updateCb({ segments: [{ id: '1', speaker: 'you', text: 'hello' }] }))
    expect(result.current.segments).toEqual([{ id: '1', speaker: 'you', text: 'hello' }])
  })

  it('updates the ready flag when a transcription status arrives', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => statusCb({ ready: true, detail: 'ok' }))
    expect(result.current.ready).toBe(true)
  })

  it('exposes the status detail message', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => statusCb({ ready: false, detail: 'downloading model' }))
    expect(result.current.statusDetail).toBe('downloading model')
  })

  it('startListening sets listening true, notifies the bridge, and calls getUserMedia', async () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    expect(result.current.listening).toBe(true)
    expect(started).toBe(1)
    await waitFor(() => expect(getUserMediaCalls).toBe(1))
  })

  it('stopListening sets listening false, notifies the bridge, and releases the mic tracks', async () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    await waitFor(() => expect(getUserMediaCalls).toBe(1))
    await act(async () => {
      result.current.stopListening()
    })
    expect(result.current.listening).toBe(false)
    expect(stopped).toBe(1)
    await waitFor(() => expect(trackStops).toBe(1))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/renderer/hooks/useTranscript.test.ts`
Expected: FAIL with `Cannot find module '../../../src/renderer/src/hooks/useTranscript'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/hooks/useTranscript.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TranscriptSegment,
  TranscriptUpdatePayload,
  TranscriptionStatusPayload
} from '../../../shared/types'
import { startCapture, type MicCaptureHandle } from '../audio/mic-capture'

export interface UseTranscript {
  segments: TranscriptSegment[]
  ready: boolean
  statusDetail: string
  /** True while a microphone listening session is active. */
  listening: boolean
  /** Begins a listening session: prompts for the mic and starts capture. */
  startListening: () => void
  /** Ends the listening session: releases the mic and resets rolling state. */
  stopListening: () => void
}

// Renderer-side transcription controller. It subscribes to transcript updates
// and transcription status from the main process, and exposes an explicit
// start/stop listening session. Capture (and the macOS microphone permission
// prompt) is never started on mount: only startListening triggers it. Mirrors
// the useCodexAnswer hook pattern: an effect wires the IPC subscriptions,
// callbacks drive the imperative actions.
export function useTranscript(): UseTranscript {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [ready, setReady] = useState(false)
  const [statusDetail, setStatusDetail] = useState('')
  const [listening, setListening] = useState(false)
  const captureRef = useRef<MicCaptureHandle | null>(null)

  useEffect(() => {
    const offUpdate = window.customcluely.onTranscriptUpdate(
      (update: TranscriptUpdatePayload) => setSegments(update.segments)
    )
    const offStatus = window.customcluely.onTranscriptionStatus(
      (status: TranscriptionStatusPayload) => {
        setReady(status.ready)
        setStatusDetail(status.detail)
      }
    )
    return () => {
      offUpdate()
      offStatus()
      void captureRef.current?.stopCapture()
      captureRef.current = null
    }
  }, [])

  const startListening = useCallback(() => {
    if (captureRef.current) return
    setListening(true)
    // Tell main to reset its rolling audio state for a fresh session.
    window.customcluely.startTranscription()
    void startCapture({
      onFrame: (pcmBase64) => window.customcluely.sendAudioFrame({ pcmBase64 }),
      onError: (message) => {
        setStatusDetail(message)
        setListening(false)
      }
    }).then((handle) => {
      captureRef.current = handle
    })
  }, [])

  const stopListening = useCallback(() => {
    setListening(false)
    window.customcluely.stopTranscription()
    void captureRef.current?.stopCapture()
    captureRef.current = null
  }, [])

  return { segments, ready, statusDetail, listening, startListening, stopListening }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/renderer/hooks/useTranscript.test.ts`
Expected: PASS, 8 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useTranscript.ts tests/renderer/hooks/useTranscript.test.ts
git commit -m "feat: add useTranscript renderer hook with explicit listening control"
```

---

## Task 16: ListenToggle component

**Files:**
- Create: `src/renderer/src/components/ListenToggle.tsx`
- Test: `tests/renderer/components/ListenToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/ListenToggle.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListenToggle } from '../../../src/renderer/src/components/ListenToggle'

describe('ListenToggle', () => {
  it('labels itself by the current listening state', () => {
    render(<ListenToggle listening={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Listening: on' })).toBeInTheDocument()
  })

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn()
    render(<ListenToggle listening={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: 'Listening: off' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows "Start listening" text when listening is false', () => {
    render(<ListenToggle listening={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Start listening')
  })

  it('shows "Stop listening" text when listening is true', () => {
    render(<ListenToggle listening={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Stop listening')
  })

  it('does not call onToggle before any click', () => {
    const onToggle = vi.fn()
    render(<ListenToggle listening={false} onToggle={onToggle} />)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/renderer/components/ListenToggle.test.tsx`
Expected: FAIL with `Cannot find module '../../../src/renderer/src/components/ListenToggle'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/components/ListenToggle.tsx` (mirrors `EyeToggle.tsx` in structure and size: a single labelled button):

```typescript
import React from 'react'

interface ListenToggleProps {
  listening: boolean
  onToggle: () => void
}

export function ListenToggle({ listening, onToggle }: ListenToggleProps): React.JSX.Element {
  return (
    <button
      className="listen-toggle"
      aria-label={`Listening: ${listening ? 'on' : 'off'}`}
      onClick={onToggle}
    >
      {listening ? 'Stop listening' : 'Start listening'}
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/renderer/components/ListenToggle.test.tsx`
Expected: PASS, 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ListenToggle.tsx tests/renderer/components/ListenToggle.test.tsx
git commit -m "feat: add ListenToggle component for explicit mic control"
```

---

## Task 17: Wire transcription end to end

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/main/index.ts`
- Create: `scripts/setup-whisper.sh`
- Create: `resources/whisper/.gitkeep`
- Test: `tests/renderer/App.test.tsx`

- [ ] **Step 1: Add a failing renderer test for the live transcript wiring**

Append this `describe` block to `tests/renderer/App.test.tsx` (keep all existing imports and cases). It mocks the full `window.customcluely` bridge and asserts the App renders a transcript segment delivered through `onTranscriptUpdate` and shows the `ListenToggle` button:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import type { TranscriptUpdatePayload } from '../../src/shared/types'

describe('App live transcript wiring', () => {
  let updateCb: (p: TranscriptUpdatePayload) => void = () => {}

  beforeEach(() => {
    updateCb = () => {}
    window.customcluely = {
      toggleInvisibility: vi.fn(),
      onOverlayState: vi.fn(() => () => {}),
      askQuestion: vi.fn(),
      onAnswerChunk: vi.fn(() => () => {}),
      onAnswerDone: vi.fn(() => () => {}),
      onAnswerError: vi.fn(() => () => {}),
      onCodexStatus: vi.fn(() => () => {}),
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      sendAudioFrame: vi.fn(),
      onTranscriptUpdate: vi.fn((cb: (p: TranscriptUpdatePayload) => void) => {
        updateCb = cb
        return () => {}
      }),
      onTranscriptionStatus: vi.fn(() => () => {})
    }
  })

  it('renders a transcript segment pushed from the main process', () => {
    render(<App />)
    act(() => updateCb({ segments: [{ id: 's1', speaker: 'you', text: 'live transcript line' }] }))
    expect(screen.getByText('live transcript line')).toBeInTheDocument()
  })

  it('renders a Start listening control and does not auto-start listening', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Listening: off' })).toBeInTheDocument()
    expect(window.customcluely.startTranscription).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/renderer/App.test.tsx`
Expected: FAIL: the App still uses static empty `segments` state, so `getByText('live transcript line')` throws a not-found error, and there is no `Listening: off` button. Existing App tests may also fail because `window.customcluely` now needs the new methods; the rewritten `beforeEach` above supplies them, but if other App test blocks build their own bridge mock they must be updated to include the five new methods. Update those mocks in this step so only the intended assertions fail.

- [ ] **Step 3: Update `src/renderer/src/App.tsx` to use the hook and the ListenToggle**

Replace the entire contents of `src/renderer/src/App.tsx` with:

```typescript
import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { ListenToggle } from './components/ListenToggle'
import { SetupBanner } from './components/SetupBanner'
import { useCodexAnswer } from './hooks/useCodexAnswer'
import { useTranscript } from './hooks/useTranscript'
import type { OverlayState, CodexStatus } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, retry } = useCodexAnswer()
  const { segments, listening, startListening, stopListening } = useTranscript()

  useEffect(() => {
    const offState = window.customcluely.onOverlayState((overlay: OverlayState) => {
      setInvisible(overlay.invisible)
    })
    const offStatus = window.customcluely.onCodexStatus((status: CodexStatus) => {
      setSetupMessage(status.available && status.authenticated ? null : status.detail)
    })
    return () => {
      offState()
      offStatus()
    }
  }, [])

  return (
    <div className="app">
      <SetupBanner message={setupMessage} />
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={state.status === 'streaming'} />
        <ListenToggle
          listening={listening}
          onToggle={() => (listening ? stopListening() : startListening())}
        />
        <EyeToggle invisible={invisible} onToggle={() => window.customcluely.toggleInvisibility()} />
      </div>
      {state.question.length > 0 && <p className="app__active-question">{state.question}</p>}
      <AnswerPanel answer={state.text} status={state.status} error={state.error} onRetry={retry} />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
```

Listening is never started on mount: the `ListenToggle`'s `onToggle` is the only path that calls `startListening`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/renderer/App.test.tsx`
Expected: PASS, the two new cases and all existing cases green.

- [ ] **Step 5: Create the whisper.cpp setup script**

Create `scripts/setup-whisper.sh`:

```bash
#!/usr/bin/env bash
# Builds whisper.cpp v1.8.4 from source and installs the whisper-cli binary
# into resources/whisper/. Run once at dev time on macOS arm64. Metal is
# enabled by default on macOS, so no extra flag is needed. The model file is
# downloaded at app first run, not here.
set -euo pipefail

WHISPER_TAG="v1.8.4"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/resources/whisper"
BUILD_DIR="$(mktemp -d)"

echo "Cloning whisper.cpp ${WHISPER_TAG} into ${BUILD_DIR}"
git clone --depth 1 --branch "${WHISPER_TAG}" \
  https://github.com/ggml-org/whisper.cpp.git "${BUILD_DIR}/whisper.cpp"

cd "${BUILD_DIR}/whisper.cpp"
echo "Configuring with CMake"
cmake -B build
echo "Building whisper-cli (Release)"
cmake --build build --config Release -j

mkdir -p "${DEST_DIR}"
cp "build/bin/whisper-cli" "${DEST_DIR}/whisper-cli"
chmod +x "${DEST_DIR}/whisper-cli"
echo "Installed whisper-cli to ${DEST_DIR}/whisper-cli"

rm -rf "${BUILD_DIR}"
echo "Done. The model is downloaded automatically on first app run."
```

- [ ] **Step 6: Create the resources placeholder and make the script executable**

Create `resources/whisper/.gitkeep` as an empty file. Then run:

```bash
chmod +x scripts/setup-whisper.sh
```

- [ ] **Step 7: Build the whisper-cli binary**

Run: `bash scripts/setup-whisper.sh`
Expected: the script clones, builds, and prints `Installed whisper-cli to .../resources/whisper/whisper-cli`. Confirm with `test -x resources/whisper/whisper-cli && echo OK`, expected output `OK`.

- [ ] **Step 8: Update `src/main/index.ts` to wire transcription**

Replace the entire contents of `src/main/index.ts` with:

```typescript
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, statSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createOverlayWindow } from './windows/overlay-window'
import { createCodexService } from './codex/codex-service'
import { checkCodexAvailability } from './codex/availability'
import { resolveCodexPath } from './codex/resolve-codex-path'
import {
  createOverlayState,
  toggleInvisible,
  toggleClickThrough,
  setVisible
} from './windows/overlay-state'
import { applyOverlayState } from './windows/overlay-controller'
import { nextPosition } from './windows/position'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys/global-hotkeys'
import { registerIpcHandlers } from './ipc/ipc-handlers'
import { resolveWhisperPaths } from './transcription/resolve-whisper-paths'
import { downloadModel, type HttpResponse } from './transcription/model-downloader'
import { createTranscriptionService } from './transcription/transcription-service'
import { runWhisper } from './transcription/whisper-runner'
import { MOVE_STEP_PX, CODEX, WHISPER } from './config/constants'
import { IpcChannel, type HotkeyAction } from '../shared/types'

let overlay: BrowserWindow | null = null
let state = createOverlayState()

function pushState(): void {
  if (!overlay) return
  applyOverlayState(overlay, state)
  overlay.webContents.send(IpcChannel.OverlayState, state)
}

function handleHotkey(action: HotkeyAction): void {
  if (!overlay) return
  switch (action) {
    case 'show-hide':
      state = setVisible(state, !state.visible)
      break
    case 'toggle-invisibility':
      state = toggleInvisible(state)
      break
    case 'toggle-click-through':
      state = toggleClickThrough(state)
      break
    case 'move-up':
    case 'move-down':
    case 'move-left':
    case 'move-right': {
      const pos = overlay.getPosition() as [number, number]
      const [x, y] = nextPosition(pos, action, MOVE_STEP_PX)
      overlay.setPosition(x, y)
      return
    }
  }
  pushState()
}

// Resolves `codex` via the `which` binary at its fixed absolute location.
function runWhich(): string | null {
  try {
    const found = execFileSync('/usr/bin/which', ['codex']).toString().trim()
    return found.length > 0 ? found : null
  } catch {
    return null
  }
}

function getCodexVersion(codexPath: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    if (codexPath === null) {
      resolve(null)
      return
    }
    execFile(codexPath, ['--version'], (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
}

function emitToOverlay(channel: string, payload: unknown): void {
  overlay?.webContents.send(channel, payload)
}

// Fetches the model over HTTPS and adapts the response to the downloader's
// injected HttpResponse shape. This is the only network call in Phase 3.
async function fetchModelHttp(url: string): Promise<HttpResponse> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  const lengthHeader = response.headers.get('content-length')
  return {
    totalBytes: lengthHeader ? Number(lengthHeader) : null,
    body: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  }
}

// Writes downloaded chunks to disk via a stream.
function writeModelStream(path: string, chunks: Buffer[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(path)
    out.on('error', reject)
    out.on('finish', resolve)
    for (const chunk of chunks) out.write(chunk)
    out.end()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.customcluely.app')
  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  const codexPath = resolveCodexPath({ fileExists: existsSync, runWhich })

  overlay = createOverlayWindow()
  overlay.on('ready-to-show', () => pushState())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  state = setVisible(state, true)

  const scratchRoot = join(app.getPath('userData'), CODEX.scratchDirName)
  const codexService = createCodexService({
    scratchRoot,
    emit: emitToOverlay,
    command: codexPath ?? undefined
  })

  // Resolve the bundled whisper assets. In a packaged app the resources live
  // under process.resourcesPath; in dev they live under the repo `resources`.
  const resourcesRoot = is.dev ? join(app.getAppPath(), 'resources') : process.resourcesPath
  const whisperPaths = resolveWhisperPaths({ resourcesRoot, fileExists: existsSync })

  const transcriptionService = createTranscriptionService({
    emit: emitToOverlay,
    runWhisper,
    modelPath: whisperPaths.modelPath,
    command: whisperPaths.binaryPath
  })

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request) => {
      void codexService.handleAsk(request)
    },
    // Starting a listening session resets the rolling audio state so the new
    // session never inherits stale PCM or transcript text from a prior one.
    onStartTranscription: () => {
      transcriptionService.reset()
    },
    // Stopping likewise clears the accumulator and rolling state. After this,
    // the renderer has released the microphone and sends no further frames.
    onStopTranscription: () => {
      transcriptionService.reset()
    },
    onAudioFrame: (frame) => {
      void transcriptionService.handleAudioFrame(frame)
    }
  })

  void checkCodexAvailability({
    getVersion: () => getCodexVersion(codexPath),
    authFileExists: () => existsSync(join(homedir(), '.codex', 'auth.json'))
  }).then((status) => emitToOverlay(IpcChannel.CodexStatus, status))

  // Download the whisper model on first run, then report readiness. The
  // binary must already be present (built by scripts/setup-whisper.sh).
  if (!whisperPaths.binaryPresent) {
    emitToOverlay(IpcChannel.TranscriptionStatus, {
      ready: false,
      detail: 'whisper-cli is missing. Run scripts/setup-whisper.sh.'
    })
  } else {
    emitToOverlay(IpcChannel.TranscriptionStatus, {
      ready: false,
      detail: 'Preparing the on-device transcription model...'
    })
    void downloadModel({
      modelPath: whisperPaths.modelPath,
      url: WHISPER.modelUrl,
      expectedBytes: WHISPER.modelByteSize,
      fileExists: existsSync,
      fileSize: (p) => statSync(p).size,
      fetchHttp: fetchModelHttp,
      writeStream: writeModelStream,
      onProgress: (fraction) => {
        emitToOverlay(IpcChannel.TranscriptionStatus, {
          ready: false,
          detail: `Downloading transcription model: ${Math.round(fraction * 100)}%`
        })
      }
    }).then((result) => {
      emitToOverlay(IpcChannel.TranscriptionStatus, {
        ready: result.ok,
        detail: result.ok ? 'On-device transcription ready.' : result.error
      })
    })
  }

  registerGlobalHotkeys(globalShortcut, handleHotkey)
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npm run test`
Expected: PASS, every test file green including all Phase 3 files.

Run: `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/App.tsx src/main/index.ts scripts/setup-whisper.sh resources/whisper/.gitkeep resources/whisper/whisper-cli tests/renderer/App.test.tsx
git commit -m "feat: wire microphone transcription end to end"
```

---

## Task 18: Phase 3 verification

**Files:**
- Create: `docs/superpowers/verification/2026-05-20-phase-3.md`

- [ ] **Step 1: Write the verification document**

Create `docs/superpowers/verification/2026-05-20-phase-3.md`:

```markdown
# Phase 3 Verification: Local Transcription

**Phase goal:** On-device transcription of microphone audio with whisper.cpp.
**Acceptance:** After the user starts a listening session, speaking produces live transcript text in the overlay with no network call for transcription.

## Automated checks

Run each command from the repository root. All must pass.

| # | Command | Expected |
|---|---------|----------|
| 1 | `npm run test` | All test files pass, including every `tests/main/transcription/*`, `tests/renderer/audio/*`, `tests/renderer/hooks/useTranscript.test.ts`, and `tests/renderer/components/ListenToggle.test.tsx`. |
| 2 | `npm run typecheck` | No type errors in node or web projects. |
| 3 | `npm run lint` | No lint errors. |
| 4 | `npm run build` | electron-vite build succeeds. |
| 5 | `test -x resources/whisper/whisper-cli && echo OK` | Prints `OK` (the bundled binary exists and is executable). |
| 6 | `git check-ignore resources/whisper/ggml-base.en.bin` | Prints the path (the model is gitignored and never committed). |
| 7 | `git ls-files resources/whisper` | Lists `resources/whisper/.gitkeep` and `resources/whisper/whisper-cli`, and NOT any `.bin` file. |

## T3.x roadmap coverage

| Roadmap item | Implemented by |
|---|---|
| T3.1 Bundle whisper.cpp binary and model download-on-first-run | `scripts/setup-whisper.sh`, `resolve-whisper-paths.ts`, `model-downloader.ts`, the `index.ts` download wiring with progress status. |
| T3.2 Renderer microphone capture (16 kHz mono PCM) | `audio/pcm-worklet.ts`, `audio/downsample.ts`, `audio/mic-capture.ts` (explicit start/stop seam). |
| T3.3 Rolling transcript buffer (immutable, speaker hint) | `transcript-buffer.ts`. |
| T3.4 Whisper runner with rolling overlapping windows and overlap de-duplication | `pcm-accumulator.ts`, `wav-encoder.ts`, `whisper-json-parser.ts`, `overlap-dedup.ts`, `whisper-runner.ts`, `transcription-service.ts`. |
| T3.5 Wire mic audio to whisper to buffer to TranscriptPanel | `ipc-handlers.ts`, `preload/api.ts`, `useTranscript.ts`, `components/ListenToggle.tsx`, `App.tsx`, `index.ts`. |
| T3.6 Phase 3 verification | This document. |

## Manual checklist

Perform these on macOS arm64 with a working microphone.

- [ ] Run `bash scripts/setup-whisper.sh` once; confirm `resources/whisper/whisper-cli` exists.
- [ ] Delete `resources/whisper/ggml-base.en.bin` if present, then run `npm run dev`.
- [ ] Confirm the overlay shows a "Downloading transcription model" status that advances to a percentage and then "On-device transcription ready."
- [ ] Confirm the overlay shows a "Start listening" button and that NO microphone permission prompt has appeared yet (capture is not auto-started).
- [ ] Click "Start listening", then grant the macOS microphone permission prompt when it appears.
- [ ] Confirm the button now reads "Stop listening" and the macOS menu-bar microphone indicator is on.
- [ ] Speak a few clear sentences into the microphone for at least 15 seconds.
- [ ] Confirm transcript lines appear in the TranscriptPanel, each labelled with the `you` speaker.
- [ ] Confirm consecutive lines do not repeat the overlapping words (the de-duplicator works).
- [ ] Click "Stop listening"; confirm the button reads "Start listening" again, the macOS microphone indicator turns off, and no new transcript lines appear while you keep speaking.
- [ ] Click "Start listening" again; confirm a fresh session starts and the new transcript does not inherit stale audio from the previous session.
- [ ] **No-network check:** open macOS Activity Monitor (Network tab) or run `nettop -p <electron pid>` while listening after the model finished downloading; confirm transcription itself produces no outbound network traffic. The only network activity in Phase 3 is the one-time model download.
- [ ] Stop and restart the app; confirm the model is not re-downloaded (it is already present at the expected size).

## Sign-off

Phase 3 is complete when every automated check passes and every manual checklist item is confirmed.
```

- [ ] **Step 2: Run all automated checks listed in the doc**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: every command exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/verification/2026-05-20-phase-3.md
git commit -m "docs: add Phase 3 transcription verification"
```

---

## Self-review

This plan has **18 tasks**.

**1. Spec coverage.** Every Phase 3 roadmap item maps to at least one task:

- T3.1 Bundle whisper.cpp binary and model download-on-first-run: Task 2 (path resolver), Task 3 (model downloader), Task 17 (setup script, `.gitkeep`, download wiring with progress status in `index.ts`). The model stays gitignored (`resources/whisper/*.bin`); the binary is committed.
- T3.2 Renderer microphone capture: Task 13 (downsampler), Task 14 (AudioWorklet and the explicit start/stop mic-capture seam). The audio-source seam is `mic-capture.ts` plus the `AudioFramePayload` channel, kept clean for Phase 4.
- T3.3 Rolling transcript buffer: Task 8 (immutable buffer; segments carry the `you`/`them` speaker hint).
- T3.4 Whisper runner with overlapping windows and de-duplication: Task 4 (PCM accumulator, 8 s window / 2 s overlap), Task 5 (WAV encoder), Task 6 (JSON parser), Task 7 (overlap de-dup), Task 9 (whisper runner), Task 10 (transcription service that ties them together and de-duplicates before appending).
- T3.5 Wire mic to whisper to buffer to TranscriptPanel: Task 11 (IPC handlers), Task 12 (preload API), Task 15 (`useTranscript`), Task 16 (`ListenToggle` component), Task 17 (`App.tsx` and `index.ts`).
- T3.6 Phase 3 verification: Task 18.

The user decision for an explicit "Start listening" toggle is covered: capture is never started on mount; Task 14's `startCapture` calls `getUserMedia` only when invoked; Task 15's `useTranscript` exposes `listening`, `startListening`, `stopListening` and never starts capture in its mount effect; Task 16 adds the dedicated `ListenToggle` component; Task 17 wires it into `App.tsx` so only a button click starts a session. Stopping releases the `MediaStream` tracks (Task 14's `stopCapture`) and resets main-process rolling state (Task 17's `onStartTranscription`/`onStopTranscription` both call `transcriptionService.reset()`).

Scope is not expanded: no summarization, no system audio, no session manager (those are Phases 4 and 5). System audio (`them`) is only mentioned as the reason the buffer's speaker field is a union; Phase 3 only ever appends `you`.

**2. Placeholder scan.** No `TODO`, `TBD`, `implement later`, `add error handling`, `similar to Task N`, or bare "write tests" placeholders. Every code step contains complete code. Task 14 has no unit test by design (browser audio APIs); this is stated explicitly and it is covered by typecheck, by the `useTranscript` test in Task 15 (which stubs `AudioContext`, `AudioWorkletNode`, and `getUserMedia`), and by the Task 18 manual checklist.

**3. Type and name consistency.** Verified across tasks:

- `IpcChannel` keys `StartTranscription`, `StopTranscription`, `AudioFrame`, `TranscriptUpdate`, `TranscriptionStatus` (Task 1) are used identically in Tasks 11, 12, 15, 17.
- `AudioFramePayload` (`pcmBase64`), `TranscriptUpdatePayload` (`segments`), `TranscriptionStatusPayload` (`ready`, `detail`) defined in Task 1 are consumed unchanged in Tasks 10, 12, 15, 17.
- `WHISPER` fields (`binaryName`, `modelFileName`, `modelUrl`, `modelByteSize`, `sampleRate`, `windowSeconds`, `overlapSeconds`, `frameSeconds`, `timeoutMs`, `scratchDirName`) defined in Task 1 are read in Tasks 2, 10, 17.
- `resolveWhisperPaths` returns `{ binaryPath, modelPath, binaryPresent, modelPresent }` (Task 2), and Task 17 reads exactly those four fields.
- `RunWhisperResult` (`ok`, `text`, `diagnostic`, `error`) is produced by `runWhisper` in Task 9 and consumed by `createTranscriptionService` in Task 10 with matching field names; the test mocks in Task 10 return the same four fields.
- `createPcmAccumulator(windowBytes, overlapBytes)` / `pushPcm(state, frame)` / `PcmAccumulatorState` (Task 4) are used with those exact signatures in Task 10.
- `createTranscriptBuffer` / `appendSegment(buffer, speaker, text)` / `readSegments` / `TranscriptBuffer` (Task 8) are used with those exact signatures in Task 10.
- `dedupOverlap(previous, next)` (Task 7) is called with that signature in Task 10.
- `encodeWav(pcm, sampleRate)` (Task 5) is called with that signature in Task 10.
- `parseWhisperJson(raw)` returning `{ ok, text }` (Task 6) is called in Task 9.
- `startCapture` returning `{ stopCapture }` and `MicCaptureHandle` (Task 14) are used in `useTranscript` (Task 15) with the matching `startCapture`/`stopCapture` names; the hook's effect cleanup and `stopListening` both call `captureRef.current?.stopCapture()`.
- `useTranscript` returns `{ segments, ready, statusDetail, listening, startListening, stopListening }` (Task 15) and Task 17's `App.tsx` destructures `{ segments, listening, startListening, stopListening }`, a subset, which is consistent.
- `ListenToggle` props are `{ listening: boolean, onToggle: () => void }` (Task 16) and Task 17's `App.tsx` passes exactly `listening={listening}` and an `onToggle` that calls `startListening`/`stopListening`.
- `IpcHandlerDeps` gains `onStartTranscription`, `onStopTranscription`, `onAudioFrame` (Task 11) and `index.ts` supplies exactly those plus the two existing handlers (Task 17); the test asserts exactly five channel registrations.

No inconsistencies found. The plan is internally consistent and ready for execution.
```