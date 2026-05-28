# Changelog

All notable changes to Whisperglass are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-05-28

### Fixed

- **Auto-answer detected questions while listening.** The renderer now
  schedules a 1500ms debounced auto-answer for the first question-style
  insight while a session is active and codex is idle. Each insight id is
  answered at most once per session, so consecutive 8s transcript windows
  do not re-fire the same answer. Previously, codex only ran when the
  user manually clicked a Default Action, typed in the command bar, or
  pressed Tab on an insight, making it appear that an answer only arrived
  after pressing Stop.
- **Screenshot capture now has a visible result.** Capturing a screenshot
  (button or Cmd+Shift+S) flashes a "Screenshot captured" toast for two
  seconds and the Screenshot button turns green and reads "Screenshot
  ready" until the next ask consumes the shot. The next Default Action
  or insight answer attaches the pending shot to codex via `-i`. Before,
  the capture worked but produced no UI feedback and the pending PNG was
  never attached to any query.

### Tests

- 6 new renderer tests cover the auto-answer debounce, the inactive
  session guard, the once-per-id ledger, the capture toast, the
  attach-to-next-action behavior, and the post-ask reset. Full suite:
  343 / 343 pass.

## [1.0.0] - 2026-05-22

### Added

- Initial open-source release as **Whisperglass** (renamed from the
  internal `CustomCluely` working name).
- Transparent, frameless, always-on-top macOS overlay with an opt-in
  invisibility toggle that uses `setContentProtection` to hide the
  window from software screen capture.
- On-device transcription of microphone and system audio via a bundled
  whisper.cpp `whisper-cli` binary, fed by a Swift capture sidecar that
  uses ScreenCaptureKit and AVAudioEngine.
- Streaming AI answers through the locally installed and already-
  authenticated `codex` CLI. No OpenAI API key lives in the app.
- Five preset Default Actions: "What should I say next", "Follow-up
  questions", "Fact check" (uses `--search`), "Recap", and "Coding help".
- Dynamic insight detection: questions and salient keywords are
  detected from the live transcript and surfaced below the command bar.
- Rolling transcript summary that keeps the codex prompt bounded.
- Screenshot capture via the sidecar, attachable to a context-ask.
- Global hotkeys for show/hide, invisibility, click-through, and overlay
  movement.
- Open-source community files: `LICENSE` (MIT), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates,
  `dependabot.yml`, and GitHub Actions CI.

### Tests

- Initial release ships with 337 tests across 50 files (renderer +
  main), 13 XCTest cases for the Swift sidecar, clean typecheck, clean
  build, clean lint.

[1.0.1]: https://github.com/ChinmayShringi/whisperglass/releases/tag/v1.0.1
[1.0.0]: https://github.com/ChinmayShringi/whisperglass/releases/tag/v1.0.0
