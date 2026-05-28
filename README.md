# Whisperglass

A local-first macOS AI meeting-copilot overlay: it listens, transcribes on-device, and answers in a transparent always-on-top window.

Whisperglass is a macOS-only desktop app that delivers live meeting insights. It runs as a transparent, frameless, always-on-top overlay that listens to a meeting, transcribes the audio on-device, and streams concise AI answers into a small black-and-white UI. The defining constraint: no OpenAI API key lives in the app. All AI reasoning runs through the locally installed and already-authenticated `codex` CLI. Transcription runs fully on-device via a bundled `whisper.cpp` binary, so speech-to-text makes no network calls.

## Features

- Transparent, frameless, always-on-top overlay with an opt-in invisibility toggle (default OFF) that uses `setContentProtection` to hide the window from software screen capture and screen sharing.
- On-device transcription of both the microphone and system audio, captured by a native Swift sidecar.
- Streamed AI answers via `codex exec`, rendered token-by-token into the answer panel.
- Default Actions: one-click preset prompts for "What should I say next", "Follow-up questions", "Fact check", "Recap", and "Coding help".
- Dynamic insight detection: questions and salient keywords are detected from the live transcript and surfaced below the command bar. Detected questions are auto-answered after a short debounce while listening, so an answer arrives without any button press.
- Rolling transcript summary that keeps the Codex prompt bounded as a meeting runs long.
- Screenshot context: pressing the Screenshot button (or Cmd+Shift+S) captures the screen, shows a confirmation toast, and attaches the shot to the next Default Action or insight answer so the response can reference on-screen content.
- Explicit meeting sessions: insights surface only while a session is active.

## Architecture

Whisperglass is built from several cooperating processes, each with a single responsibility:

- **Electron main (Node.js):** app lifecycle, the overlay window, global hotkeys, IPC, and supervision of the child processes.
- **Renderer (Chromium, React + TypeScript):** the black-and-white overlay UI (command bar, transcript panel, answer panel). It talks to the main process only through a `contextBridge` preload API, with no direct Node access.
- **Swift capture sidecar:** a standalone arm64 binary that captures system audio via ScreenCaptureKit, the microphone via AVAudioEngine, and on-demand screenshots. It is supervised by the main process and restarted on crash.
- **Bundled whisper.cpp:** a self-contained `whisper-cli` binary that transcribes 16 kHz mono PCM audio on-device.
- **codex CLI:** the AI brain. The Codex runner spawns `codex exec` once per query and streams the JSONL event output back into the overlay.

## Requirements

- macOS on Apple Silicon (arm64).
- Node.js (with npm).
- The `codex` CLI installed and authenticated. Run `codex login` once before using the app.
- An Xcode / Swift toolchain to build the capture sidecar.
- CMake and a C/C++ toolchain to build the bundled whisper.cpp binary.

## Setup

```sh
# Install Node dependencies
npm install

# Build the bundled whisper.cpp binary (one-time, on-device transcription)
bash scripts/setup-whisper.sh

# Build the Swift capture sidecar (one-time)
bash scripts/setup-sidecar.sh

# Run the app in development
npm run dev

# Package a macOS build
npm run build:mac
```

The whisper model file is downloaded automatically on first app run, not by the setup script.

## Project status

The automated test suite passes: 343 tests across 50 files (`npm run test`). The TypeScript typecheck (`npm run typecheck`) and the production build (`npm run build`) are clean, `npm run lint` exits 0 (prettier formatting warnings only, no errors), and the Swift sidecar tests pass (`swift test --package-path sidecar`, 13 tests).

Full manual GUI verification is still pending: the microphone and screen-capture flows, the macOS permission prompts (Screen Recording, Microphone), and the invisibility toggle need to be exercised against the real app. See `docs/superpowers/verification/` for the per-phase manual checklists.

## Tech stack

Electron, TypeScript, electron-vite, React, Swift (SwiftPM), whisper.cpp, the `codex` CLI, Vitest, and XCTest.

## License

MIT. See [LICENSE](./LICENSE).

## Disclaimer

This is an independent, educational open-source project. It is not affiliated with, sponsored by, or endorsed by any commercial meeting-assistant product.
