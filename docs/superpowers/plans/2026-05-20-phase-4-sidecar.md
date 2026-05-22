# Phase 4: Swift Capture Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the roadmap, every task runs through the 3-agent pipeline (implementer, auditor, documenter).

**Goal:** Add a native macOS Swift capture sidecar that captures system audio (ScreenCaptureKit) and the microphone (AVAudioEngine), takes on-demand screenshots excluding the app's own overlay window, and streams everything to Electron over a newline-delimited JSON stdio protocol, supervised with restart on crash, so that audio from another macOS app is captured and transcribed and a screenshot can be attached to a Codex query.

**Architecture:** A standalone SwiftPM executable (`sidecar/`, arm64) runs as a long-lived child of the Electron main process. It owns three capture units (`SystemAudioCapture` with ScreenCaptureKit, `MicrophoneCapture` with AVAudioEngine, `ScreenCapture` with `SCScreenshotManager`) and a pure `StdioProtocol` codec. Main to sidecar and sidecar to main messages are newline-delimited JSON; audio frames carry base64 16 kHz mono 16-bit PCM. Electron main gains a `SidecarSupervisor` that mirrors the proven `whisper-runner.ts`/`codex-runner.ts` subprocess shape: it spawns the binary, parses the protocol defensively (malformed lines are skipped, never thrown), routes `audio` frames into the existing `TranscriptionService`, and on crash restarts with exponential backoff while emitting an "audio paused" status to the renderer. Phase 4 also retires the Phase 3 renderer `getUserMedia` stopgap: microphone capture moves into the sidecar, so all audio (mic plus system) flows through one path, and each audio frame carries a `you`/`them` speaker hint. The pure logic (the Swift `StdioProtocol` codec, the TS-side `sidecar-protocol` parser) is dependency-injected and fully unit-tested; the capture classes and the spawn/supervise glue are thin and verified by the manual checklist.

**Tech Stack:** Swift 6.3.1, Xcode 26.4.1, SwiftPM (arm64-apple-macosx, `.macOS(.v14)` minimum), ScreenCaptureKit, AVFoundation/AVFAudio, XCTest. Electron 39, TypeScript (no semicolons, single quotes, 2-space indent, prettier `trailingComma: none`), React 19 (`React.JSX.Element`), electron-vite, Vitest 4 (no globals, node default environment, jsdom for renderer tests).

---

## Pinned research facts (do not re-research)

Verified on 2026-05-22. Treat as fixed inputs.

1. **Toolchain.** The dev machine has Swift 6.3.1 (`swiftlang-6.3.1.1.2`) and Xcode 26.4.1. `swift --version` reports `Target: arm64-apple-macosx26.0`. SwiftPM and `swift build`/`swift test` are available without opening Xcode.

2. **SwiftPM executable + test package shape.** A `Package.swift` for a macOS arm64 executable with tests declares `// swift-tools-version: 6.0`, `platforms: [.macOS(.v14)]`, an `.executableTarget`, and a `.testTarget` that depends on the executable target's logic. Targets map to folders: `Sources/<TargetName>/` and `Tests/<TargetName>Tests/`. Because XCTest cannot import an executable target's `@main` symbol cleanly, the testable pure logic (the `StdioProtocol` codec and message types) lives in a separate library target (`SidecarCore`) that both the executable target and the test target depend on. Build a release binary with `swift build -c release` (output at `.build/release/<executable-name>`). Run tests with `swift test`. The platform minimum is `.macOS(.v14)`: ScreenCaptureKit audio capture and `SCScreenshotManager` both require macOS 14+, and the project is macOS-only.

3. **ScreenCaptureKit system audio.** System audio is captured by an `SCStream` whose `SCStreamConfiguration` sets `capturesAudio = true`. ScreenCaptureKit's native audio output is 48 kHz stereo Float32 (`SCStreamConfiguration` exposes `sampleRate` and `channelCount`; the documented native values are 48000 and 2). Audio sample buffers arrive on the `SCStreamOutput` delegate's `stream(_:didOutputSampleBuffer:of:)` callback with the output type `.audio`. A `CMSampleBuffer` of audio is converted to raw PCM via `CMSampleBufferGetDataBuffer` plus `CMBlockBufferCopyDataBytes`, or by reading it through an `AVAudioPCMBuffer`. The sidecar normalizes ScreenCaptureKit's 48 kHz stereo Float32 down to 16 kHz mono 16-bit PCM with `AVAudioConverter` (see fact 4) so the frame format matches what `TranscriptionService` already expects. `SCContentFilter(display:excludingWindows:)` builds a filter that EXCLUDES specific windows; passing the overlay window's `SCWindow` there guarantees screenshots never contain the overlay. The current API names (`SCShareableContent`, `SCContentFilter`, `SCStream`, `SCStreamConfiguration`, `SCStreamOutput`, `SCStreamDelegate`) are stable on macOS 14, 15, and 26; no relevant deprecations. Note: ScreenCaptureKit was historically used for an app's OWN microphone too via `captureMicrophone`/`microphoneCaptureDeviceID` (macOS 15+), but this plan uses AVAudioEngine for the microphone (fact 4) to keep the mic path independent of the screen-recording stream and its permission.

4. **AVAudioEngine microphone + AVAudioConverter.** The microphone is captured by `AVAudioEngine`: take `engine.inputNode`, read its `inputFormat(forBus: 0)`, install a tap with `inputNode.installTap(onBus:bufferSize:format:)` whose callback receives an `AVAudioPCMBuffer`, and call `engine.start()`. The input format is typically 44.1 or 48 kHz Float32; it is resampled and reformatted to 16 kHz mono 16-bit signed-integer PCM with an `AVAudioConverter` created from the input format to a target `AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)`. `AVAudioConverter.convert(to:error:withInputFrom:)` performs the sample-rate conversion. The same `AVAudioConverter` approach reformats the system-audio buffers in fact 3. The resulting Int16 PCM bytes are read out of the converted `AVAudioPCMBuffer`'s `int16ChannelData`.

5. **Screenshot capture.** A single frame is captured with `SCScreenshotManager.captureImage(contentFilter:configuration:)` (macOS 14.0+; a capture bug in 14.0 to 14.3 was fixed in 14.4, acceptable for v1 local use on a current OS). It takes an `SCContentFilter` and an `SCStreamConfiguration` and returns a `CGImage`. The overlay is excluded by passing the same `SCContentFilter(display:excludingWindows:)` used for audio. The `CGImage` is encoded to PNG with `NSBitmapImageRep(cgImage:)` then `representation(using: .png, properties: [:])`, and the PNG `Data` is base64-encoded into the protocol's `screenshot` message. The overlay window is identified inside the sidecar by matching `SCWindow.owningApplication?.bundleIdentifier` against the app bundle id passed on the `start` message, plus the window title; the simplest robust v1 rule is to exclude every window owned by the app's own bundle id.

6. **macOS TCC permissions for a helper binary.** Screen Recording: `CGPreflightScreenCaptureAccess()` checks whether access is granted (it never prompts); `CGRequestScreenCaptureAccess()` requests it and returns the resulting Boolean. Microphone: `AVCaptureDevice.authorizationStatus(for: .audio)` returns `.authorized`/`.denied`/`.notDetermined`/`.restricted`, and `AVCaptureDevice.requestAccess(for: .audio)` prompts. Known issue (spec section 19): a plain command-line executable that is NOT inside a properly structured `.app` bundle still receives and honors the screen-recording permission once granted, but does not appear by name in System Settings to Screen Recording. macOS ties the permission to the code-signing identity, and an ad-hoc-signed binary's identity changes every build. **Dev-time decision for v1 (recorded below):** the sidecar is launched as a child process of the Electron `.app`; the TCC permission attaches to the parent app's identity and the parent app is what appears in System Settings. The plan does not notarize or build a separate helper `.app` bundle (explicitly out of v1 scope). The sidecar simply detects denial and reports it over the protocol; the renderer banner deep-links to the System Settings pane and instructs the user to grant the permission to "Customcluely" (the Electron app). This is the pragmatic, documented dev-time caveat; it is verified in the Phase 4 manual checklist.

7. **Electron spawning a long-lived Swift child over stdio.** The project already supervises `codex` (`src/main/codex/codex-runner.ts`, transient per query) and `whisper-cli` (`src/main/transcription/whisper-runner.ts`, spawned per window). Both use `child_process.spawn` with `stdio: ['ignore', 'pipe', 'pipe']`, bind the `error` handler before touching stdio streams, and keep raw stderr out of user-facing messages (the `diagnostic` vs `error` split). The sidecar differs in being long-lived and bidirectional: main writes JSON commands to the child's `stdin` and reads newline-delimited JSON events from its `stdout`. The supervisor reuses the existing `splitLines` line buffer from `src/main/codex/line-splitter.ts` to frame stdout, mirrors the `whisper-runner.ts` error handling, and adds spawn-on-crash with exponential backoff.

8. **Sidecar binary build and bundling (mirrors `scripts/setup-whisper.sh`).** Phase 3 ships `scripts/setup-whisper.sh`, which builds a native binary and copies it into `resources/`. Phase 4 adds the analogous `scripts/setup-sidecar.sh`, which runs `swift build -c release --package-path sidecar` and copies `sidecar/.build/release/customcluely-sidecar` to `resources/sidecar/customcluely-sidecar`. `index.ts` resolves it exactly as it resolves `whisper-cli`: a pure `resolveSidecarPath` resolver under a `resourcesRoot`. The compiled binary IS committed to git (it is small and the app must run without re-building); `sidecar/.build/` is already gitignored. `resources/sidecar/customcluely-sidecar` is added to git; `electron-builder` already copies `resources/**` into the packaged app.

## Decisions recorded

- **Sidecar build and bundling.** Build script: `scripts/setup-sidecar.sh`. Build command: `swift build -c release --package-path sidecar`. Destination: `resources/sidecar/customcluely-sidecar`, committed to git. `index.ts` resolves it via a pure `resolveSidecarPath({ resourcesRoot, fileExists })` returning `{ binaryPath, binaryPresent }`, identical in spirit to `resolveWhisperPaths`. A `resources/sidecar/.gitkeep` keeps the directory tracked.

- **Protocol framing and malformed-line tolerance.** Newline-delimited JSON, UTF-8, one JSON object per line, exactly as spec section 11. The TS-side parser (`sidecar-protocol.ts`) is pure and total: `parseSidecarLine(line)` returns a discriminated union event and, for any line that is empty, not valid JSON, missing `type`, or carrying an unknown `type`, returns `{ kind: 'ignored' }` and NEVER throws. This mirrors the defensive `parseCodexLine` style in `src/main/codex/event-parser.ts`. The Swift `StdioProtocol` decoder is equally defensive: an unparseable line is dropped. The encoder always emits compact single-line JSON terminated by `\n`.

- **Removing the renderer `getUserMedia` path (T4.6).** Microphone capture moves entirely into the sidecar. Deleted: `src/renderer/src/audio/mic-capture.ts`, `src/renderer/src/audio/pcm-worklet.ts`, `src/renderer/src/audio/downsample.ts`, and their tests (`tests/renderer/audio/downsample.test.ts`). The `src/renderer/src/audio/` directory is removed. The `IpcChannel.AudioFrame` renderer-to-main channel and `AudioFramePayload`/`sendAudioFrame` preload method are removed (the renderer no longer produces audio). Kept: `TranscriptUpdatePayload`, `TranscriptionStatusPayload`, `TranscriptSegment`, the `TranscriptUpdate`/`TranscriptionStatus` channels, the `ListenToggle` component, and `useTranscript`. Changed: `useTranscript.startListening`/`stopListening` no longer call `startCapture`/`getUserMedia`; they only call `startTranscription`/`stopTranscription`, which now drive the sidecar via the supervisor in main. `TranscriptionService.handleAudioFrame` keeps its existing signature and is fed by the supervisor instead of by IPC; it gains a per-frame `source` (`'system' | 'mic'`) so the appended segment's speaker is `them` for system audio and `you` for the mic.

- **Supervisor restart with backoff and "audio paused" surfacing.** `SidecarSupervisor` restarts the process on unexpected exit with exponential backoff (1 s, 2 s, 4 s, 8 s, capped at 8 s; reset to 1 s after a process stays up past a stable threshold). A new `IpcChannel.SidecarStatus` channel carries a `SidecarStatusPayload` (`{ state: 'capturing' | 'paused' | 'stopped' | 'error', detail: string }`), following the `TranscriptionStatusPayload` precedent. While the sidecar is down and being restarted, the supervisor emits `state: 'paused'` with detail "Audio paused, reconnecting capture..."; when it is back up and capturing it emits `state: 'capturing'`. The renderer shows an "audio paused" banner from this status.

- **Dev-time TCC story.** Per pinned fact 6: the sidecar runs as a child of the Electron `.app`, so screen-recording and microphone permissions attach to the parent app's code-signing identity, and "Customcluely" is what the user grants in System Settings. No separate helper bundle, no notarization (out of v1 scope). The sidecar detects denial via `CGPreflightScreenCaptureAccess()` and `AVCaptureDevice.authorizationStatus(for:)`, emits `permission` messages, and the renderer surfaces a banner deep-linking to the relevant System Settings pane. In dev, after the first `npm run dev`, the user grants the permission once to the Electron dev app; ad-hoc rebuilds of the Swift binary alone do not change the parent app identity, so the grant persists. The Phase 4 verification doc records this caveat and the manual grant step.

---

## File Structure

Every file created or modified in Phase 4, with its single responsibility.

### Created - Swift sidecar package (`sidecar/`)

- `sidecar/Package.swift` - SwiftPM manifest: `.macOS(.v14)`, an executable target `customcluely-sidecar`, a library target `SidecarCore` (the pure, testable codec and message types), and a test target `SidecarCoreTests`.
- `sidecar/Sources/SidecarCore/ProtocolMessages.swift` - the `Codable` message types for both directions of the stdio protocol (commands in, events out).
- `sidecar/Sources/SidecarCore/StdioProtocol.swift` - pure codec: encode an outbound event to a single JSON line; decode an inbound line to a command, tolerating malformed input. No I/O.
- `sidecar/Sources/customcluely-sidecar/main.swift` - the executable entry point: reads stdin lines, decodes commands via `StdioProtocol`, drives the capture units, writes events to stdout.
- `sidecar/Sources/customcluely-sidecar/StdioTransport.swift` - thin glue: a line-buffered stdin reader and a stdout writer that serialize access so concurrent capture callbacks never interleave a half-written line.
- `sidecar/Sources/customcluely-sidecar/AudioResampler.swift` - wraps `AVAudioConverter` to turn an `AVAudioPCMBuffer` (any rate/channels/format) into 16 kHz mono 16-bit PCM `Data`.
- `sidecar/Sources/customcluely-sidecar/SystemAudioCapture.swift` - ScreenCaptureKit `SCStream` with `capturesAudio`, excluding the overlay window; emits `audio` events with `source: "system"`.
- `sidecar/Sources/customcluely-sidecar/MicrophoneCapture.swift` - `AVAudioEngine` input-node tap; emits `audio` events with `source: "mic"`.
- `sidecar/Sources/customcluely-sidecar/ScreenCapture.swift` - on-demand single-frame screenshot via `SCScreenshotManager`, excluding the overlay window; emits a `screenshot` event.
- `sidecar/Sources/customcluely-sidecar/Permissions.swift` - checks Screen Recording and Microphone TCC status, requests them, emits `permission` events.
- `sidecar/Sources/customcluely-sidecar/CaptureCoordinator.swift` - owns the three capture units and the permission checks; turns decoded commands (`start`, `screenshot`, `stop`, `shutdown`) into actions and routes their output to the transport.
- `sidecar/Tests/SidecarCoreTests/StdioProtocolTests.swift` - XCTest coverage of the pure codec: round-trip every event, decode every command, and confirm malformed lines are dropped.

### Created - main process (`src/main/sidecar/`)

- `src/main/sidecar/sidecar-protocol.ts` - pure parser: `parseSidecarLine(line)` returns a discriminated-union `SidecarEvent`; total and never throws. Also `encodeSidecarCommand(command)` that serializes a main-to-sidecar command to a newline-terminated JSON line.
- `src/main/sidecar/backoff.ts` - pure exponential-backoff calculator: given an attempt count, returns the delay in ms (1000, 2000, 4000, 8000, capped).
- `src/main/sidecar/sidecar-supervisor.ts` - spawns and supervises the sidecar child process: writes commands to stdin, frames stdout with `splitLines`, parses events, routes them to injected callbacks, and restarts with backoff on unexpected exit. Mirrors `whisper-runner.ts` error handling.

### Created - main process (`src/main/transcription/`)

- `src/main/transcription/resolve-sidecar-path.ts` - pure resolver for the bundled `customcluely-sidecar` binary path under a resources root; reports whether it is present.

### Modified - main process

- `src/main/config/constants.ts` (MODIFIED) - adds the `SIDECAR` const (binary name, spawn/backoff timings, the app bundle id) following the `WHISPER`/`CODEX` pattern.
- `src/main/transcription/transcription-service.ts` (MODIFIED) - `handleAudioFrame` accepts an optional `source` (`'system' | 'mic'`), keeps an independent rolling accumulator and `previousWindowText` per source, and appends segments with the matching `you`/`them` speaker.
- `src/main/ipc/ipc-handlers.ts` (MODIFIED) - the `AudioFrame` channel and its `onAudioFrame` dep are removed (the renderer no longer sends audio); `onStartTranscription`/`onStopTranscription` remain and now also start/stop the sidecar capture.
- `src/main/index.ts` (MODIFIED) - resolves the sidecar path, constructs the `SidecarSupervisor`, wires sidecar `audio` events into `TranscriptionService.handleAudioFrame`, wires `screenshot`/`permission`/`status` events to IPC, starts/stops capture from the transcription IPC handlers, and shuts the sidecar down on quit.
- `src/shared/types.ts` (MODIFIED) - removes `AudioFramePayload` and the `AudioFrame` channel; adds the `SidecarStatus` and `Screenshot` channels and the `SidecarStatusPayload` and `ScreenshotPayload` interfaces.

### Modified - preload and renderer

- `src/preload/api.ts` (MODIFIED) - removes `sendAudioFrame`; adds `onSidecarStatus` and `onScreenshot` subscriptions.
- `src/renderer/src/hooks/useTranscript.ts` (MODIFIED) - `startListening`/`stopListening` no longer call `startCapture`; they only notify the bridge. Adds `audioPaused` derived from `onSidecarStatus`.
- `src/renderer/src/App.tsx` (MODIFIED) - renders the "audio paused" banner from `useTranscript`'s `audioPaused`.

### Deleted - renderer (the Phase 3 getUserMedia stopgap)

- `src/renderer/src/audio/mic-capture.ts` (DELETED)
- `src/renderer/src/audio/pcm-worklet.ts` (DELETED)
- `src/renderer/src/audio/downsample.ts` (DELETED)
- `tests/renderer/audio/downsample.test.ts` (DELETED)

### Created - scripts and resources

- `scripts/setup-sidecar.sh` - dev-time script that builds the Swift sidecar in release mode and installs the binary into `resources/sidecar/`.
- `resources/sidecar/customcluely-sidecar` - the compiled binary, committed (produced by the setup script).
- `resources/sidecar/.gitkeep` - keeps the directory tracked.

### Created - tests (`tests/`)

- `tests/main/sidecar/sidecar-protocol.test.ts`
- `tests/main/sidecar/backoff.test.ts`
- `tests/main/sidecar/sidecar-supervisor.test.ts`
- `tests/main/transcription/resolve-sidecar-path.test.ts`
- `tests/main/transcription/transcription-service.test.ts` (MODIFIED) - adds coverage for the per-source `you`/`them` routing.
- `tests/main/ipc/ipc-handlers.test.ts` (MODIFIED) - drops the `AudioFrame` case, keeps the start/stop cases.
- `tests/preload/api.test.ts` (MODIFIED) - drops the `sendAudioFrame` case, adds `onSidecarStatus`/`onScreenshot`.
- `tests/renderer/hooks/useTranscript.test.ts` (MODIFIED) - drops the `getUserMedia`/`AudioContext` stubs, adds the `audioPaused` case.
- `tests/renderer/App.test.tsx` (MODIFIED) - updates the bridge mock to the new API surface, adds an "audio paused" banner case.
- `tests/fixtures/sidecar/mock-sidecar.mjs` - a mock sidecar (Node script) that speaks the protocol over stdio for the supervisor test.
- `tests/fixtures/sidecar/mock-sidecar-crash.mjs` - a mock sidecar that exits non-zero shortly after start, to exercise restart with backoff.

### Created - docs

- `docs/superpowers/verification/2026-05-20-phase-4.md` - the Phase 4 verification doc (automated checks plus manual checklist).

---

## Task 1: Swift package scaffold and StdioProtocol codec (T4.1)

**Files:**
- Create: `sidecar/Package.swift`
- Create: `sidecar/Sources/SidecarCore/ProtocolMessages.swift`
- Create: `sidecar/Sources/SidecarCore/StdioProtocol.swift`
- Create: `sidecar/Tests/SidecarCoreTests/StdioProtocolTests.swift`
- Create: `sidecar/Sources/customcluely-sidecar/main.swift` (minimal placeholder so the executable target compiles)

- [ ] **Step 1: Create the SwiftPM manifest**

Create `sidecar/Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "customcluely-sidecar",
    platforms: [
        // ScreenCaptureKit audio capture and SCScreenshotManager both require
        // macOS 14. The whole app is macOS-only, so this is the floor.
        .macOS(.v14)
    ],
    targets: [
        // Pure, testable logic: the stdio protocol codec and message types.
        // Kept separate from the executable target so XCTest can import it
        // without pulling in `@main`.
        .target(name: "SidecarCore"),
        // The capture executable. Capture units live here; they need real
        // audio and screen hardware and are verified by the manual checklist.
        .executableTarget(
            name: "customcluely-sidecar",
            dependencies: ["SidecarCore"]
        ),
        .testTarget(
            name: "SidecarCoreTests",
            dependencies: ["SidecarCore"]
        )
    ]
)
```

- [ ] **Step 2: Create the protocol message types**

Create `sidecar/Sources/SidecarCore/ProtocolMessages.swift`:

```swift
import Foundation

/// One command sent by Electron main TO the sidecar over stdin.
/// Newline-delimited JSON, one object per line (design spec section 11).
public enum SidecarCommand: Equatable {
    /// Begin capture for the listed sources. `capture` values are
    /// "systemAudio" and/or "mic". `appBundleId` identifies the app whose
    /// own windows must be excluded from screenshots.
    case start(capture: [String], appBundleId: String)
    /// Capture one screenshot frame on demand.
    case screenshot
    /// Stop all capture but keep the process alive.
    case stop
    /// Stop capture and exit the process.
    case shutdown
}

/// One event sent by the sidecar TO Electron main over stdout.
public enum SidecarEvent: Equatable {
    /// A chunk of 16 kHz mono 16-bit PCM. `source` is "system" or "mic".
    /// `pcm` is base64-encoded. `seq` is a monotonically increasing counter.
    case audio(source: String, seq: Int, sampleRate: Int, pcm: String)
    /// A captured screenshot frame. `data` is a base64-encoded PNG.
    case screenshot(format: String, data: String)
    /// A capture-state change. `state` is "capturing", "stopped", or "error".
    case status(state: String, detail: String)
    /// The result of a TCC permission check. `kind` is "screen" or "mic".
    case permission(kind: String, granted: Bool)
}
```

- [ ] **Step 3: Write the failing test**

Create `sidecar/Tests/SidecarCoreTests/StdioProtocolTests.swift`:

```swift
import XCTest
@testable import SidecarCore

final class StdioProtocolTests: XCTestCase {

    // MARK: decoding commands

    func testDecodesStartCommand() {
        let line = #"{"type":"start","capture":["systemAudio","mic"],"appBundleId":"com.customcluely.app"}"#
        let command = StdioProtocol.decodeCommand(line)
        XCTAssertEqual(
            command,
            .start(capture: ["systemAudio", "mic"], appBundleId: "com.customcluely.app")
        )
    }

    func testDecodesStartCommandWithMissingBundleIdAsEmptyString() {
        let line = #"{"type":"start","capture":["mic"]}"#
        let command = StdioProtocol.decodeCommand(line)
        XCTAssertEqual(command, .start(capture: ["mic"], appBundleId: ""))
    }

    func testDecodesScreenshotCommand() {
        XCTAssertEqual(StdioProtocol.decodeCommand(#"{"type":"screenshot"}"#), .screenshot)
    }

    func testDecodesStopCommand() {
        XCTAssertEqual(StdioProtocol.decodeCommand(#"{"type":"stop"}"#), .stop)
    }

    func testDecodesShutdownCommand() {
        XCTAssertEqual(StdioProtocol.decodeCommand(#"{"type":"shutdown"}"#), .shutdown)
    }

    func testReturnsNilForInvalidJson() {
        XCTAssertNil(StdioProtocol.decodeCommand("not json at all"))
    }

    func testReturnsNilForEmptyLine() {
        XCTAssertNil(StdioProtocol.decodeCommand(""))
    }

    func testReturnsNilForUnknownCommandType() {
        XCTAssertNil(StdioProtocol.decodeCommand(#"{"type":"explode"}"#))
    }

    func testReturnsNilForJsonMissingType() {
        XCTAssertNil(StdioProtocol.decodeCommand(#"{"capture":["mic"]}"#))
    }

    // MARK: encoding events

    func testEncodesAudioEventAsSingleLineJson() {
        let line = StdioProtocol.encodeEvent(
            .audio(source: "system", seq: 7, sampleRate: 16000, pcm: "QUJD")
        )
        XCTAssertFalse(line.contains("\n"))
        let decoded = try? JSONSerialization.jsonObject(with: Data(line.utf8))
        let object = decoded as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "audio")
        XCTAssertEqual(object?["source"] as? String, "system")
        XCTAssertEqual(object?["seq"] as? Int, 7)
        XCTAssertEqual(object?["sampleRate"] as? Int, 16000)
        XCTAssertEqual(object?["pcm"] as? String, "QUJD")
    }

    func testEncodesScreenshotEvent() {
        let line = StdioProtocol.encodeEvent(.screenshot(format: "png", data: "aW1n"))
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "screenshot")
        XCTAssertEqual(object?["format"] as? String, "png")
        XCTAssertEqual(object?["data"] as? String, "aW1n")
    }

    func testEncodesStatusEvent() {
        let line = StdioProtocol.encodeEvent(.status(state: "capturing", detail: "ok"))
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "status")
        XCTAssertEqual(object?["state"] as? String, "capturing")
        XCTAssertEqual(object?["detail"] as? String, "ok")
    }

    func testEncodesPermissionEvent() {
        let line = StdioProtocol.encodeEvent(.permission(kind: "screen", granted: true))
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "permission")
        XCTAssertEqual(object?["kind"] as? String, "screen")
        XCTAssertEqual(object?["granted"] as? Bool, true)
    }
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `swift test --package-path sidecar`
Expected: FAIL to compile with errors such as `cannot find 'StdioProtocol' in scope` (the type does not exist yet) and `customcluely-sidecar` having no `main.swift`.

- [ ] **Step 5: Create the minimal executable entry point so the package compiles**

Create `sidecar/Sources/customcluely-sidecar/main.swift`:

```swift
// Phase 4 Task 1 placeholder entry point. The full stdin/stdout loop and the
// capture units are added in later tasks (Task 6 onward). This minimal body
// lets the executable target compile so `swift test` can build the package.
import Foundation

FileHandle.standardError.write(Data("customcluely-sidecar: not yet wired\n".utf8))
exit(0)
```

- [ ] **Step 6: Write the StdioProtocol codec implementation**

Create `sidecar/Sources/SidecarCore/StdioProtocol.swift`:

```swift
import Foundation

/// Pure, total codec for the newline-delimited JSON stdio protocol. It does
/// no I/O. Decoding is defensive: any malformed, empty, or unknown line
/// returns nil and never throws, mirroring the Electron-side parseCodexLine
/// style. Encoding always produces compact single-line JSON.
public enum StdioProtocol {

    /// Decodes one inbound line into a SidecarCommand, or nil when the line
    /// is empty, not valid JSON, missing "type", or carries an unknown type.
    public static func decodeCommand(_ line: String) -> SidecarCommand? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let object = raw as? [String: Any],
              let type = object["type"] as? String
        else {
            return nil
        }
        switch type {
        case "start":
            let capture = (object["capture"] as? [String]) ?? []
            let bundleId = (object["appBundleId"] as? String) ?? ""
            return .start(capture: capture, appBundleId: bundleId)
        case "screenshot":
            return .screenshot
        case "stop":
            return .stop
        case "shutdown":
            return .shutdown
        default:
            return nil
        }
    }

    /// Encodes one outbound event as a single line of compact JSON. The line
    /// has no trailing newline; the transport appends "\n" when it writes.
    public static func encodeEvent(_ event: SidecarEvent) -> String {
        let object: [String: Any]
        switch event {
        case let .audio(source, seq, sampleRate, pcm):
            object = [
                "type": "audio", "source": source, "seq": seq,
                "sampleRate": sampleRate, "pcm": pcm
            ]
        case let .screenshot(format, data):
            object = ["type": "screenshot", "format": format, "data": data]
        case let .status(state, detail):
            object = ["type": "status", "state": state, "detail": detail]
        case let .permission(kind, granted):
            object = ["type": "permission", "kind": kind, "granted": granted]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let string = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return string
    }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `swift test --package-path sidecar`
Expected: PASS, all 13 cases in `StdioProtocolTests` green.

- [ ] **Step 8: Commit**

```bash
git add sidecar/Package.swift sidecar/Sources/SidecarCore sidecar/Sources/customcluely-sidecar/main.swift sidecar/Tests/SidecarCoreTests
git commit -m "feat: scaffold Swift sidecar package and StdioProtocol codec"
```

---

## Task 2: SIDECAR constants and Phase 4 shared types (T4.1, T4.5)

**Files:**
- Modify: `src/main/config/constants.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block to `tests/shared/types.test.ts` inside the existing top-level area (keep all existing imports and cases; add the `SIDECAR` import alongside the existing `WHISPER` import from `'../../src/main/config/constants'`):

```typescript
import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'
import { SIDECAR } from '../../src/main/config/constants'

describe('Phase 4 IpcChannel entries', () => {
  it('defines the sidecar status and screenshot channels', () => {
    expect(IpcChannel.SidecarStatus).toBe('sidecar:status')
    expect(IpcChannel.Screenshot).toBe('sidecar:screenshot')
  })

  it('no longer defines the renderer AudioFrame channel', () => {
    expect((IpcChannel as Record<string, string>).AudioFrame).toBeUndefined()
  })
})

describe('SIDECAR constants', () => {
  it('pins the binary name, app bundle id, and supervisor timings', () => {
    expect(SIDECAR.binaryName).toBe('customcluely-sidecar')
    expect(SIDECAR.appBundleId).toBe('com.customcluely.app')
    expect(SIDECAR.stableUptimeMs).toBe(10_000)
    expect(SIDECAR.maxBackoffMs).toBe(8_000)
    expect(SIDECAR.baseBackoffMs).toBe(1_000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/shared/types.test.ts`
Expected: FAIL: `IpcChannel.SidecarStatus` is `undefined`, and `SIDECAR` is not exported from constants.

- [ ] **Step 3: Update `src/shared/types.ts`**

Replace the `IpcChannel` const and the `AudioFramePayload` interface. Replace the whole file with:

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
  TranscriptUpdate: 'transcription:update',
  TranscriptionStatus: 'transcription:status',
  SidecarStatus: 'sidecar:status',
  Screenshot: 'sidecar:screenshot'
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

/** The full immutable transcript pushed to the renderer after every change. */
export interface TranscriptUpdatePayload {
  segments: TranscriptSegment[]
}

/** Reports whether on-device transcription is ready to run. */
export interface TranscriptionStatusPayload {
  ready: boolean
  detail: string
}

/**
 * Reports the live state of the Swift capture sidecar. `paused` is shown to
 * the user as an "audio paused" banner while the supervisor restarts a
 * crashed sidecar.
 */
export interface SidecarStatusPayload {
  state: 'capturing' | 'paused' | 'stopped' | 'error'
  detail: string
}

/** One on-demand screenshot delivered by the sidecar, as a base64 PNG. */
export interface ScreenshotPayload {
  format: 'png'
  dataBase64: string
}
```

- [ ] **Step 4: Add the `SIDECAR` const to `src/main/config/constants.ts`**

Append this block to the end of `src/main/config/constants.ts` (after the existing `WHISPER` const, do not change anything above it):

```typescript
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/shared/types.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: this will FAIL until later tasks remove `AudioFramePayload` consumers. That is expected at this point; do not try to fix the downstream files here. Note the failing files (`src/preload/api.ts`, `src/main/ipc/ipc-handlers.ts`, `src/main/transcription/transcription-service.ts` if it imports the payload) and proceed; Tasks 8 to 12 fix each one. Re-run `npm run typecheck` at Task 12 and expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/config/constants.ts tests/shared/types.test.ts
git commit -m "feat: add Phase 4 sidecar IPC channels, types, and SIDECAR constants"
```

---

## Task 3: TS-side sidecar protocol parser and encoder (T4.5)

**Files:**
- Create: `src/main/sidecar/sidecar-protocol.ts`
- Test: `tests/main/sidecar/sidecar-protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/sidecar/sidecar-protocol.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  parseSidecarLine,
  encodeSidecarCommand
} from '../../../src/main/sidecar/sidecar-protocol'

describe('parseSidecarLine', () => {
  it('parses an audio event', () => {
    const line = JSON.stringify({
      type: 'audio',
      source: 'system',
      seq: 3,
      sampleRate: 16000,
      pcm: 'QUJD'
    })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'audio',
      source: 'system',
      seq: 3,
      sampleRate: 16000,
      pcm: 'QUJD'
    })
  })

  it('parses a mic-source audio event', () => {
    const line = JSON.stringify({
      type: 'audio',
      source: 'mic',
      seq: 1,
      sampleRate: 16000,
      pcm: 'AAAA'
    })
    const event = parseSidecarLine(line)
    expect(event.kind).toBe('audio')
    if (event.kind === 'audio') expect(event.source).toBe('mic')
  })

  it('parses a screenshot event', () => {
    const line = JSON.stringify({ type: 'screenshot', format: 'png', data: 'aW1n' })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'screenshot',
      format: 'png',
      dataBase64: 'aW1n'
    })
  })

  it('parses a status event', () => {
    const line = JSON.stringify({ type: 'status', state: 'capturing', detail: 'ok' })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'status',
      state: 'capturing',
      detail: 'ok'
    })
  })

  it('parses a permission event', () => {
    const line = JSON.stringify({ type: 'permission', kind: 'screen', granted: false })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'permission',
      permissionKind: 'screen',
      granted: false
    })
  })

  it('returns ignored for an empty line', () => {
    expect(parseSidecarLine('')).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for invalid JSON', () => {
    expect(parseSidecarLine('not json')).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for JSON missing a type', () => {
    expect(parseSidecarLine(JSON.stringify({ source: 'system' }))).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for an unknown event type', () => {
    expect(parseSidecarLine(JSON.stringify({ type: 'explode' }))).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for an audio event with a non-string pcm', () => {
    const line = JSON.stringify({ type: 'audio', source: 'system', seq: 1, sampleRate: 16000, pcm: 42 })
    expect(parseSidecarLine(line)).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for an audio event with an unknown source', () => {
    const line = JSON.stringify({ type: 'audio', source: 'radio', seq: 1, sampleRate: 16000, pcm: 'AA' })
    expect(parseSidecarLine(line)).toEqual({ kind: 'ignored' })
  })

  it('never throws on arbitrary input', () => {
    expect(() => parseSidecarLine('{{{')).not.toThrow()
    expect(() => parseSidecarLine('null')).not.toThrow()
    expect(() => parseSidecarLine('[]')).not.toThrow()
  })
})

describe('encodeSidecarCommand', () => {
  it('encodes a start command as one newline-terminated JSON line', () => {
    const line = encodeSidecarCommand({
      type: 'start',
      capture: ['systemAudio', 'mic'],
      appBundleId: 'com.customcluely.app'
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.indexOf('\n')).toBe(line.length - 1)
    expect(JSON.parse(line)).toEqual({
      type: 'start',
      capture: ['systemAudio', 'mic'],
      appBundleId: 'com.customcluely.app'
    })
  })

  it('encodes a screenshot command', () => {
    expect(encodeSidecarCommand({ type: 'screenshot' })).toBe('{"type":"screenshot"}\n')
  })

  it('encodes a stop command', () => {
    expect(encodeSidecarCommand({ type: 'stop' })).toBe('{"type":"stop"}\n')
  })

  it('encodes a shutdown command', () => {
    expect(encodeSidecarCommand({ type: 'shutdown' })).toBe('{"type":"shutdown"}\n')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/sidecar/sidecar-protocol.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/sidecar/sidecar-protocol'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/sidecar/sidecar-protocol.ts`:

```typescript
// Pure, total codec for the Swift sidecar's newline-delimited JSON stdio
// protocol (design spec section 11). parseSidecarLine never throws: any
// empty, malformed, or unrecognized line returns { kind: 'ignored' },
// mirroring the defensive parseCodexLine style. encodeSidecarCommand
// serializes a main-to-sidecar command to one newline-terminated JSON line.

/** A capture-source label as it appears on the wire. */
export type AudioSource = 'system' | 'mic'

/** A discriminated-union event decoded from one sidecar stdout line. */
export type SidecarEvent =
  | { kind: 'audio'; source: AudioSource; seq: number; sampleRate: number; pcm: string }
  | { kind: 'screenshot'; format: 'png'; dataBase64: string }
  | { kind: 'status'; state: string; detail: string }
  | { kind: 'permission'; permissionKind: 'screen' | 'mic'; granted: boolean }
  | { kind: 'ignored' }

/** A command sent from Electron main to the sidecar. */
export type SidecarCommand =
  | { type: 'start'; capture: string[]; appBundleId: string }
  | { type: 'screenshot' }
  | { type: 'stop' }
  | { type: 'shutdown' }

const IGNORED: SidecarEvent = { kind: 'ignored' }

function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

// Parses one line of sidecar stdout. Total: returns { kind: 'ignored' } for
// anything it cannot confidently interpret, and never throws.
export function parseSidecarLine(line: string): SidecarEvent {
  const trimmed = line.trim()
  if (trimmed.length === 0) return IGNORED
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return IGNORED
  }
  const object = asObject(parsed)
  if (!object) return IGNORED
  const type = object.type
  if (typeof type !== 'string') return IGNORED

  switch (type) {
    case 'audio': {
      const source = object.source
      const seq = object.seq
      const sampleRate = object.sampleRate
      const pcm = object.pcm
      if (
        (source === 'system' || source === 'mic') &&
        typeof seq === 'number' &&
        typeof sampleRate === 'number' &&
        typeof pcm === 'string'
      ) {
        return { kind: 'audio', source, seq, sampleRate, pcm }
      }
      return IGNORED
    }
    case 'screenshot': {
      const data = object.data
      if (typeof data === 'string') {
        return { kind: 'screenshot', format: 'png', dataBase64: data }
      }
      return IGNORED
    }
    case 'status': {
      const state = object.state
      const detail = object.detail
      if (typeof state === 'string') {
        return { kind: 'status', state, detail: typeof detail === 'string' ? detail : '' }
      }
      return IGNORED
    }
    case 'permission': {
      const kind = object.kind
      const granted = object.granted
      if ((kind === 'screen' || kind === 'mic') && typeof granted === 'boolean') {
        return { kind: 'permission', permissionKind: kind, granted }
      }
      return IGNORED
    }
    default:
      return IGNORED
  }
}

// Serializes a main-to-sidecar command to a single newline-terminated JSON
// line ready to write to the child's stdin.
export function encodeSidecarCommand(command: SidecarCommand): string {
  return `${JSON.stringify(command)}\n`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/sidecar/sidecar-protocol.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/sidecar/sidecar-protocol.ts tests/main/sidecar/sidecar-protocol.test.ts
git commit -m "feat: add TypeScript sidecar protocol parser and encoder"
```

---

## Task 4: Exponential backoff calculator (T4.5)

**Files:**
- Create: `src/main/sidecar/backoff.ts`
- Test: `tests/main/sidecar/backoff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/sidecar/backoff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { backoffDelayMs } from '../../../src/main/sidecar/backoff'

describe('backoffDelayMs', () => {
  it('returns the base delay for the first attempt', () => {
    expect(backoffDelayMs(1, 1000, 8000)).toBe(1000)
  })

  it('doubles the delay each attempt', () => {
    expect(backoffDelayMs(2, 1000, 8000)).toBe(2000)
    expect(backoffDelayMs(3, 1000, 8000)).toBe(4000)
    expect(backoffDelayMs(4, 1000, 8000)).toBe(8000)
  })

  it('caps the delay at the maximum', () => {
    expect(backoffDelayMs(5, 1000, 8000)).toBe(8000)
    expect(backoffDelayMs(20, 1000, 8000)).toBe(8000)
  })

  it('treats attempt 0 or negative as the base delay', () => {
    expect(backoffDelayMs(0, 1000, 8000)).toBe(1000)
    expect(backoffDelayMs(-3, 1000, 8000)).toBe(1000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/sidecar/backoff.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/sidecar/backoff'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/sidecar/backoff.ts`:

```typescript
// Pure exponential-backoff calculator for the sidecar supervisor. attempt 1
// yields the base delay, each later attempt doubles it, and the result is
// capped at the maximum. attempt values below 1 are clamped to 1 so the
// caller never has to special-case the first restart.
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const safeAttempt = attempt < 1 ? 1 : attempt
  const raw = baseMs * 2 ** (safeAttempt - 1)
  return Math.min(raw, maxMs)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/sidecar/backoff.test.ts`
Expected: PASS, 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/sidecar/backoff.ts tests/main/sidecar/backoff.test.ts
git commit -m "feat: add exponential backoff calculator for sidecar restarts"
```

---

## Task 5: Sidecar path resolver (T4.5)

**Files:**
- Create: `src/main/transcription/resolve-sidecar-path.ts`
- Test: `tests/main/transcription/resolve-sidecar-path.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/transcription/resolve-sidecar-path.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolveSidecarPath } from '../../../src/main/transcription/resolve-sidecar-path'

describe('resolveSidecarPath', () => {
  it('builds the binary path under the resources root', () => {
    const result = resolveSidecarPath({
      resourcesRoot: '/app/resources',
      fileExists: () => true
    })
    expect(result.binaryPath).toBe('/app/resources/sidecar/customcluely-sidecar')
  })

  it('reports the binary present when the file exists', () => {
    const result = resolveSidecarPath({
      resourcesRoot: '/app/resources',
      fileExists: (p) => p === '/app/resources/sidecar/customcluely-sidecar'
    })
    expect(result.binaryPresent).toBe(true)
  })

  it('reports the binary missing when the file does not exist', () => {
    const result = resolveSidecarPath({
      resourcesRoot: '/app/resources',
      fileExists: () => false
    })
    expect(result.binaryPresent).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/transcription/resolve-sidecar-path.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/transcription/resolve-sidecar-path'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/transcription/resolve-sidecar-path.ts`:

```typescript
import { join } from 'node:path'
import { SIDECAR } from '../config/constants'

export interface ResolveSidecarPathDeps {
  /** Absolute path to the app resources directory. */
  resourcesRoot: string
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
}

export interface SidecarPaths {
  binaryPath: string
  binaryPresent: boolean
}

// Pure resolver for the bundled Swift capture sidecar binary. It never throws
// and never touches the real filesystem: existence is dependency-injected.
// Mirrors resolveWhisperPaths.
export function resolveSidecarPath(deps: ResolveSidecarPathDeps): SidecarPaths {
  const binaryPath = join(deps.resourcesRoot, 'sidecar', SIDECAR.binaryName)
  return {
    binaryPath,
    binaryPresent: deps.fileExists(binaryPath)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/transcription/resolve-sidecar-path.test.ts`
Expected: PASS, 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/resolve-sidecar-path.ts tests/main/transcription/resolve-sidecar-path.test.ts
git commit -m "feat: add sidecar binary path resolver"
```

---

## Task 6: Sidecar transport, audio resampler, and main loop (T4.1, T4.2, T4.3)

This task builds the Swift glue and capture units. They need real audio and screen hardware, so they have no XCTest coverage (the pure codec is covered in Task 1); they are verified by the Phase 4 manual checklist (Task 12). Every file's complete code is shown. The verification gate for this task is that the package builds in release mode.

**Files:**
- Create: `sidecar/Sources/customcluely-sidecar/StdioTransport.swift`
- Create: `sidecar/Sources/customcluely-sidecar/AudioResampler.swift`
- Create: `sidecar/Sources/customcluely-sidecar/SystemAudioCapture.swift`
- Create: `sidecar/Sources/customcluely-sidecar/MicrophoneCapture.swift`
- Create: `sidecar/Sources/customcluely-sidecar/ScreenCapture.swift`
- Create: `sidecar/Sources/customcluely-sidecar/Permissions.swift`
- Create: `sidecar/Sources/customcluely-sidecar/CaptureCoordinator.swift`
- Modify: `sidecar/Sources/customcluely-sidecar/main.swift`

- [ ] **Step 1: Create the stdio transport**

Create `sidecar/Sources/customcluely-sidecar/StdioTransport.swift`:

```swift
import Foundation
import SidecarCore

/// Thin glue around stdin and stdout. Reading is line-buffered: stdin data
/// arrives in arbitrary chunks, so partial lines are held until a newline
/// completes them. Writing is serialized through a lock so concurrent capture
/// callbacks (system audio, microphone) never interleave a half-written line.
final class StdioTransport {
    private let writeLock = NSLock()
    private var inputBuffer = Data()

    /// Writes one event as a single newline-terminated JSON line to stdout.
    func send(_ event: SidecarEvent) {
        let line = StdioProtocol.encodeEvent(event) + "\n"
        writeLock.lock()
        defer { writeLock.unlock() }
        FileHandle.standardOutput.write(Data(line.utf8))
    }

    /// Reads stdin until EOF, invoking `onCommand` for every complete line that
    /// decodes to a valid command. Malformed lines are silently dropped. This
    /// call blocks the calling thread, so it runs on a dedicated thread.
    func readLoop(onCommand: @escaping (SidecarCommand) -> Void) {
        let handle = FileHandle.standardInput
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty {
                // EOF: the parent closed the pipe. Treat it as shutdown.
                onCommand(.shutdown)
                return
            }
            inputBuffer.append(chunk)
            while let newlineIndex = inputBuffer.firstIndex(of: 0x0A) {
                let lineData = inputBuffer.subdata(in: inputBuffer.startIndex..<newlineIndex)
                inputBuffer.removeSubrange(inputBuffer.startIndex...newlineIndex)
                if let line = String(data: lineData, encoding: .utf8),
                   let command = StdioProtocol.decodeCommand(line) {
                    onCommand(command)
                }
            }
        }
    }
}
```

- [ ] **Step 2: Create the audio resampler**

Create `sidecar/Sources/customcluely-sidecar/AudioResampler.swift`:

```swift
import Foundation
import AVFAudio

/// Converts an AVAudioPCMBuffer of any sample rate, channel count, and sample
/// format into 16 kHz mono 16-bit signed-integer PCM. Both capture paths feed
/// through this so the bytes on the wire always match the format the Electron
/// TranscriptionService already expects (16 kHz mono 16-bit PCM).
final class AudioResampler {
    static let targetSampleRate: Double = 16_000

    private let targetFormat: AVAudioFormat
    private var converter: AVAudioConverter?
    private var sourceFormatDescription: String = ""

    init() {
        self.targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: AudioResampler.targetSampleRate,
            channels: 1,
            interleaved: true
        )!
    }

    /// Converts one input buffer to 16 kHz mono 16-bit PCM bytes. Returns nil
    /// when conversion fails. The AVAudioConverter is rebuilt whenever the
    /// input format changes (the first buffer, or a device switch).
    func resample(_ input: AVAudioPCMBuffer) -> Data? {
        let inputFormat = input.format
        let descriptor = "\(inputFormat.sampleRate)-\(inputFormat.channelCount)"
        if descriptor != sourceFormatDescription || converter == nil {
            converter = AVAudioConverter(from: inputFormat, to: targetFormat)
            sourceFormatDescription = descriptor
        }
        guard let converter else { return nil }

        let ratio = AudioResampler.targetSampleRate / inputFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(input.frameLength) * ratio) + 1
        guard let output = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: capacity
        ) else {
            return nil
        }

        var fed = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, statusPointer in
            if fed {
                statusPointer.pointee = .noDataNow
                return nil
            }
            fed = true
            statusPointer.pointee = .haveData
            return input
        }
        guard status != .error, conversionError == nil,
              let channelData = output.int16ChannelData
        else {
            return nil
        }
        let frameCount = Int(output.frameLength)
        return Data(bytes: channelData[0], count: frameCount * MemoryLayout<Int16>.size)
    }
}
```

- [ ] **Step 3: Create the permissions checker**

Create `sidecar/Sources/customcluely-sidecar/Permissions.swift`:

```swift
import Foundation
import AVFoundation
import CoreGraphics

/// Checks and requests the two TCC permissions the sidecar needs: Screen
/// Recording (for system audio and screenshots) and Microphone. Per the
/// design spec section 19, the sidecar runs as a child of the Electron app,
/// so the permission attaches to the parent app's code-signing identity.
enum Permissions {

    /// True when Screen Recording access is already granted. Never prompts.
    static func hasScreenAccess() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Requests Screen Recording access. Returns the resulting grant state.
    /// macOS shows the prompt only on the first call for this identity.
    @discardableResult
    static func requestScreenAccess() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    /// True when Microphone access is already granted.
    static func hasMicAccess() -> Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    /// Requests Microphone access, invoking `completion` with the grant state.
    static func requestMicAccess(completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio, completionHandler: completion)
    }
}
```

- [ ] **Step 4: Create the system audio capture**

Create `sidecar/Sources/customcluely-sidecar/SystemAudioCapture.swift`:

```swift
import Foundation
import ScreenCaptureKit
import AVFAudio

/// Captures macOS system audio with a ScreenCaptureKit SCStream. The stream's
/// SCContentFilter excludes every window owned by the host app's bundle id,
/// so the audio stream (and any screenshot built from the same filter) never
/// includes the app's own overlay. ScreenCaptureKit delivers 48 kHz stereo
/// Float32 audio sample buffers; each is resampled to 16 kHz mono 16-bit PCM.
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let resampler = AudioResampler()
    private let onPcm: (Data) -> Void
    private let onError: (String) -> Void
    private var stream: SCStream?

    init(onPcm: @escaping (Data) -> Void, onError: @escaping (String) -> Void) {
        self.onPcm = onPcm
        self.onError = onError
    }

    /// Starts capturing system audio, excluding windows owned by `appBundleId`.
    func start(appBundleId: String) {
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true
                )
                guard let display = content.displays.first else {
                    onError("No display available for system audio capture.")
                    return
                }
                let ownWindows = content.windows.filter {
                    $0.owningApplication?.bundleIdentifier == appBundleId
                }
                let filter = SCContentFilter(display: display, excludingWindows: ownWindows)

                let config = SCStreamConfiguration()
                config.capturesAudio = true
                config.sampleRate = 48_000
                config.channelCount = 2
                // The video path is unused but a stream needs a size; keep it
                // tiny so ScreenCaptureKit does minimal video work.
                config.width = 2
                config.height = 2

                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                try stream.addStreamOutput(
                    self,
                    type: .audio,
                    sampleHandlerQueue: DispatchQueue(label: "sidecar.systemaudio")
                )
                try await stream.startCapture()
                self.stream = stream
            } catch {
                onError("System audio capture failed: \(error.localizedDescription)")
            }
        }
    }

    /// Stops the stream and releases it.
    func stop() {
        guard let stream else { return }
        self.stream = nil
        Task { try? await stream.stopCapture() }
    }

    // MARK: SCStreamOutput

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio,
              let pcmBuffer = sampleBuffer.toPCMBuffer()
        else {
            return
        }
        if let pcm = resampler.resample(pcmBuffer) {
            onPcm(pcm)
        }
    }

    // MARK: SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onError("System audio stream stopped: \(error.localizedDescription)")
    }
}

private extension CMSampleBuffer {
    /// Builds an AVAudioPCMBuffer from a ScreenCaptureKit audio CMSampleBuffer.
    func toPCMBuffer() -> AVAudioPCMBuffer? {
        guard let formatDescription = CMSampleBufferGetFormatDescription(self),
              let streamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(
                  formatDescription
              )
        else {
            return nil
        }
        let format = AVAudioFormat(streamDescription: streamBasicDescription)
        guard let format else { return nil }
        let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(self))
        guard frameCount > 0,
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)
        else {
            return nil
        }
        pcmBuffer.frameLength = frameCount
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            self,
            at: 0,
            frameCount: Int32(frameCount),
            into: pcmBuffer.mutableAudioBufferList
        )
        return status == noErr ? pcmBuffer : nil
    }
}
```

- [ ] **Step 5: Create the microphone capture**

Create `sidecar/Sources/customcluely-sidecar/MicrophoneCapture.swift`:

```swift
import Foundation
import AVFAudio

/// Captures the default microphone with AVAudioEngine. A tap on the input
/// node delivers AVAudioPCMBuffers at the device's native format; each is
/// resampled to 16 kHz mono 16-bit PCM. Kept independent of the
/// ScreenCaptureKit stream so the microphone works even if Screen Recording
/// permission is denied.
final class MicrophoneCapture {
    private let resampler = AudioResampler()
    private let onPcm: (Data) -> Void
    private let onError: (String) -> Void
    private let engine = AVAudioEngine()
    private var running = false

    init(onPcm: @escaping (Data) -> Void, onError: @escaping (String) -> Void) {
        self.onPcm = onPcm
        self.onError = onError
    }

    /// Installs the input tap and starts the engine.
    func start() {
        guard !running else { return }
        let inputNode = engine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else {
            onError("Microphone has no usable input format.")
            return
        }
        inputNode.installTap(onBus: 0, bufferSize: 4_096, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            if let pcm = self.resampler.resample(buffer) {
                self.onPcm(pcm)
            }
        }
        do {
            try engine.start()
            running = true
        } catch {
            inputNode.removeTap(onBus: 0)
            onError("Microphone capture failed: \(error.localizedDescription)")
        }
    }

    /// Removes the tap and stops the engine.
    func stop() {
        guard running else { return }
        running = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
```

- [ ] **Step 6: Create the screenshot capture**

Create `sidecar/Sources/customcluely-sidecar/ScreenCapture.swift`:

```swift
import Foundation
import ScreenCaptureKit
import AppKit

/// Captures one screen frame on demand with SCScreenshotManager. The same
/// SCContentFilter exclusion used for audio is applied here, so the captured
/// PNG never contains the app's own overlay window.
enum ScreenCapture {

    /// Captures the main display, excluding windows owned by `appBundleId`,
    /// and returns the frame as PNG Data. Returns nil on any failure.
    static func capturePng(appBundleId: String) async -> Data? {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            guard let display = content.displays.first else { return nil }
            let ownWindows = content.windows.filter {
                $0.owningApplication?.bundleIdentifier == appBundleId
            }
            let filter = SCContentFilter(display: display, excludingWindows: ownWindows)

            let config = SCStreamConfiguration()
            config.width = display.width
            config.height = display.height

            let cgImage = try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: config
            )
            return pngData(from: cgImage)
        } catch {
            return nil
        }
    }

    /// Encodes a CGImage to PNG bytes.
    private static func pngData(from cgImage: CGImage) -> Data? {
        let rep = NSBitmapImageRep(cgImage: cgImage)
        return rep.representation(using: .png, properties: [:])
    }
}
```

- [ ] **Step 7: Create the capture coordinator**

Create `sidecar/Sources/customcluely-sidecar/CaptureCoordinator.swift`:

```swift
import Foundation
import SidecarCore

/// Owns the three capture units and the permission checks, and turns decoded
/// commands into actions. It is the single place that emits SidecarEvents
/// through the transport, so the audio sequence counters and the capture
/// status are consistent.
final class CaptureCoordinator {
    private let transport: StdioTransport
    private var systemAudio: SystemAudioCapture?
    private var microphone: MicrophoneCapture?
    private var appBundleId = ""
    private var systemSeq = 0
    private var micSeq = 0
    private let seqLock = NSLock()

    init(transport: StdioTransport) {
        self.transport = transport
    }

    /// Handles one decoded command. `shouldExit` is true after `shutdown`.
    func handle(_ command: SidecarCommand) -> (shouldExit: Bool, Void) {
        switch command {
        case let .start(capture, bundleId):
            start(capture: capture, appBundleId: bundleId)
            return (false, ())
        case .screenshot:
            captureScreenshot()
            return (false, ())
        case .stop:
            stop()
            transport.send(.status(state: "stopped", detail: "Capture stopped."))
            return (false, ())
        case .shutdown:
            stop()
            return (true, ())
        }
    }

    private func start(capture: [String], appBundleId: String) {
        self.appBundleId = appBundleId
        reportPermissions(capture: capture)

        if capture.contains("systemAudio") {
            let unit = SystemAudioCapture(
                onPcm: { [weak self] data in self?.emitAudio(source: "system", pcm: data) },
                onError: { [weak self] message in
                    self?.transport.send(.status(state: "error", detail: message))
                }
            )
            unit.start(appBundleId: appBundleId)
            systemAudio = unit
        }
        if capture.contains("mic") {
            let unit = MicrophoneCapture(
                onPcm: { [weak self] data in self?.emitAudio(source: "mic", pcm: data) },
                onError: { [weak self] message in
                    self?.transport.send(.status(state: "error", detail: message))
                }
            )
            unit.start()
            microphone = unit
        }
        transport.send(.status(state: "capturing", detail: "Capture started."))
    }

    private func stop() {
        systemAudio?.stop()
        systemAudio = nil
        microphone?.stop()
        microphone = nil
    }

    private func captureScreenshot() {
        let bundleId = appBundleId
        Task {
            if let png = await ScreenCapture.capturePng(appBundleId: bundleId) {
                transport.send(.screenshot(format: "png", data: png.base64EncodedString()))
            } else {
                transport.send(.status(state: "error", detail: "Screenshot capture failed."))
            }
        }
    }

    private func reportPermissions(capture: [String]) {
        if capture.contains("systemAudio") {
            let granted = Permissions.hasScreenAccess()
            if !granted { Permissions.requestScreenAccess() }
            transport.send(.permission(kind: "screen", granted: Permissions.hasScreenAccess()))
        }
        if capture.contains("mic") {
            if Permissions.hasMicAccess() {
                transport.send(.permission(kind: "mic", granted: true))
            } else {
                Permissions.requestMicAccess { [weak self] granted in
                    self?.transport.send(.permission(kind: "mic", granted: granted))
                }
            }
        }
    }

    private func emitAudio(source: String, pcm: Data) {
        seqLock.lock()
        let seq: Int
        if source == "system" {
            systemSeq += 1
            seq = systemSeq
        } else {
            micSeq += 1
            seq = micSeq
        }
        seqLock.unlock()
        transport.send(.audio(
            source: source,
            seq: seq,
            sampleRate: Int(AudioResampler.targetSampleRate),
            pcm: pcm.base64EncodedString()
        ))
    }
}
```

- [ ] **Step 8: Replace the executable entry point with the real main loop**

Replace the entire contents of `sidecar/Sources/customcluely-sidecar/main.swift` with:

```swift
import Foundation

// Entry point for the Customcluely capture sidecar. It reads newline-delimited
// JSON commands from stdin, drives the capture units through CaptureCoordinator,
// and writes newline-delimited JSON events to stdout. The stdin read loop runs
// on a dedicated thread; the main run loop stays alive so async capture
// callbacks (ScreenCaptureKit, AVAudioEngine) keep firing.

let transport = StdioTransport()
let coordinator = CaptureCoordinator(transport: transport)

let readThread = Thread {
    transport.readLoop { command in
        let result = coordinator.handle(command)
        if result.shouldExit {
            exit(0)
        }
    }
}
readThread.stackSize = 1 << 20
readThread.start()

// Keep the process alive for async capture callbacks until `shutdown` calls
// exit(0) from the read thread.
RunLoop.main.run()
```

- [ ] **Step 9: Build the package in release mode to verify it compiles**

Run: `swift build -c release --package-path sidecar`
Expected: PASS, the build succeeds and produces `sidecar/.build/release/customcluely-sidecar`. Confirm with `test -x sidecar/.build/release/customcluely-sidecar && echo OK`, expected output `OK`.

- [ ] **Step 10: Run the Swift tests to confirm the codec still passes**

Run: `swift test --package-path sidecar`
Expected: PASS, the 13 `StdioProtocolTests` cases still green (the capture files added no new tests but must not break the build).

- [ ] **Step 11: Commit**

```bash
git add sidecar/Sources/customcluely-sidecar
git commit -m "feat: add Swift capture units, resampler, and stdio main loop"
```

---

## Task 7: Sidecar build script and bundled binary (T4.1)

**Files:**
- Create: `scripts/setup-sidecar.sh`
- Create: `resources/sidecar/.gitkeep`
- Create: `resources/sidecar/customcluely-sidecar` (produced by the script)

- [ ] **Step 1: Create the build script**

Create `scripts/setup-sidecar.sh`:

```bash
#!/usr/bin/env bash
# Builds the Customcluely Swift capture sidecar in release mode and installs
# the binary into resources/sidecar/. Run once at dev time on macOS arm64.
# Mirrors scripts/setup-whisper.sh: a dev-time native build that commits its
# product so the app runs without a build step.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR_DIR="${REPO_ROOT}/sidecar"
DEST_DIR="${REPO_ROOT}/resources/sidecar"

echo "Building customcluely-sidecar (release)"
swift build -c release --package-path "${SIDECAR_DIR}"

BUILT_BINARY="${SIDECAR_DIR}/.build/release/customcluely-sidecar"
if [ ! -x "${BUILT_BINARY}" ]; then
  echo "Build did not produce ${BUILT_BINARY}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
cp "${BUILT_BINARY}" "${DEST_DIR}/customcluely-sidecar"
chmod +x "${DEST_DIR}/customcluely-sidecar"
echo "Installed customcluely-sidecar to ${DEST_DIR}/customcluely-sidecar"
```

- [ ] **Step 2: Create the resources placeholder and make the script executable**

Create `resources/sidecar/.gitkeep` as an empty file. Then run:

```bash
chmod +x scripts/setup-sidecar.sh
```

- [ ] **Step 3: Build the sidecar binary**

Run: `bash scripts/setup-sidecar.sh`
Expected: the script builds and prints `Installed customcluely-sidecar to .../resources/sidecar/customcluely-sidecar`. Confirm with `test -x resources/sidecar/customcluely-sidecar && echo OK`, expected output `OK`.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-sidecar.sh resources/sidecar/.gitkeep resources/sidecar/customcluely-sidecar
git commit -m "feat: add sidecar build script and bundled binary"
```

---

## Task 8: Per-source transcription routing (T4.6)

**Files:**
- Modify: `src/main/transcription/transcription-service.ts`
- Modify: `tests/main/transcription/transcription-service.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/main/transcription/transcription-service.test.ts` with:

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
    await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    expect(runWhisper).not.toHaveBeenCalled()
  })

  it('runs whisper once a full 8-second window is buffered for one source', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const service = createTranscriptionService(makeDeps(runWhisper))
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('appends a mic-source window with the "you" speaker', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    const payload = updateCall![1] as { segments: { speaker: string; text: string }[] }
    expect(payload.segments[0].speaker).toBe('you')
  })

  it('appends a system-source window with the "them" speaker', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'system audio line', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'system')
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    const payload = updateCall![1] as { segments: { speaker: string; text: string }[] }
    expect(payload.segments[0].speaker).toBe('them')
  })

  it('keeps independent rolling windows per source', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'a line', diagnostic: '', error: '' }))
    const service = createTranscriptionService(makeDeps(runWhisper))
    // 7 mic frames and 7 system frames: neither source reaches a full window.
    for (let i = 0; i < 7; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'system')
    }
    expect(runWhisper).not.toHaveBeenCalled()
    // The 8th mic frame completes the mic window only.
    await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('de-duplicates the overlap within a single source', async () => {
    const runWhisper = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: 'the meeting starts now', diagnostic: '', error: '' })
      .mockResolvedValueOnce({ ok: true, text: 'starts now and runs long', diagnostic: '', error: '' })
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 16; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
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
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    const updates = deps.emit.mock.calls.filter((c) => c[0] === IpcChannel.TranscriptUpdate)
    expect(updates).toHaveLength(0)
  })

  it('reset clears the buffer and both per-source accumulators', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    service.reset()
    deps.emit.mockClear()
    for (let i = 0; i < 7; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('defaults the source to mic when none is given', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'defaulted', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    const payload = updateCall![1] as { segments: { speaker: string }[] }
    expect(payload.segments[0].speaker).toBe('you')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/transcription/transcription-service.test.ts`
Expected: FAIL: `handleAudioFrame` currently takes one argument and keeps a single accumulator, so the per-source cases (`them` speaker, independent windows) fail.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/main/transcription/transcription-service.ts` with:

```typescript
import { join } from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { WHISPER } from '../config/constants'
import { IpcChannel, type TranscriptSegment } from '../../shared/types'
import { createPcmAccumulator, pushPcm, type PcmAccumulatorState } from './pcm-accumulator'
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

/** Which capture source a frame came from. Drives the speaker hint. */
export type AudioFrameSource = 'system' | 'mic'

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
  /**
   * Accepts one PCM frame. `source` selects the rolling window and the
   * speaker hint: 'mic' transcribes as 'you', 'system' as 'them'. Defaults
   * to 'mic' so any pre-Phase-4 single-argument caller stays valid.
   */
  handleAudioFrame: (payload: unknown, source?: AudioFrameSource) => Promise<void>
  /** Clears all transcript state, for a new session. */
  reset: () => void
}

// Per-source rolling state: each capture source has its own audio accumulator
// and its own previous-window text for de-duplication, but they share the one
// transcript buffer so the panel shows a single interleaved transcript.
interface SourceState {
  accumulator: PcmAccumulatorState
  previousWindowText: string
  inFlight: boolean
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

function speakerOf(source: AudioFrameSource): TranscriptSegment['speaker'] {
  return source === 'system' ? 'them' : 'you'
}

// Orchestrates transcription for both capture sources. It accumulates each
// source's PCM frames into independent rolling 8 s windows (2 s overlap), runs
// whisper on each completed window, de-duplicates the overlap against that
// source's previous window, appends the new text to the shared immutable
// transcript buffer with the matching speaker, and emits the full transcript
// to the renderer. Mirrors codex-service.ts: a per-source single-flight guard
// ensures only one whisper subprocess runs per source at a time.
export function createTranscriptionService(deps: TranscriptionServiceDeps): TranscriptionService {
  let buffer: TranscriptBuffer = createTranscriptBuffer()

  function freshSourceState(): SourceState {
    return {
      accumulator: createPcmAccumulator(WINDOW_BYTES, OVERLAP_BYTES),
      previousWindowText: '',
      inFlight: false
    }
  }

  const sources: Record<AudioFrameSource, SourceState> = {
    system: freshSourceState(),
    mic: freshSourceState()
  }

  async function transcribeWindow(window: Buffer, source: AudioFrameSource): Promise<void> {
    const scratchRoot = join(tmpdir(), WHISPER.scratchDirName)
    const wavPath = join(scratchRoot, `window-${source}-${randomUUID()}.wav`)
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
        const state = sources[source]
        const fresh = dedupOverlap(state.previousWindowText, result.text)
        state.previousWindowText = result.text
        if (fresh.length > 0) {
          buffer = appendSegment(buffer, speakerOf(source), fresh)
          deps.emit(IpcChannel.TranscriptUpdate, { segments: readSegments(buffer) })
        }
      }
    } finally {
      await rm(wavPath, { force: true }).catch(() => {})
    }
  }

  async function handleAudioFrame(
    payload: unknown,
    source: AudioFrameSource = 'mic'
  ): Promise<void> {
    const pcm = pcmOf(payload)
    if (pcm === null) return
    const state = sources[source]
    const pushed = pushPcm(state.accumulator, pcm)
    state.accumulator = pushed.state
    if (pushed.window === null) return
    // Single-flight per source: drop windows that arrive while this source's
    // whisper run is still going so the subprocess never queues up.
    if (state.inFlight) return
    state.inFlight = true
    try {
      await transcribeWindow(pushed.window, source)
    } finally {
      state.inFlight = false
    }
  }

  function reset(): void {
    buffer = createTranscriptBuffer()
    sources.system = freshSourceState()
    sources.mic = freshSourceState()
  }

  return { handleAudioFrame, reset }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/transcription/transcription-service.test.ts`
Expected: PASS, all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcription/transcription-service.ts tests/main/transcription/transcription-service.test.ts
git commit -m "feat: route transcription per capture source with you/them speaker"
```

---

## Task 9: Sidecar supervisor (T4.5)

**Files:**
- Create: `src/main/sidecar/sidecar-supervisor.ts`
- Create: `tests/fixtures/sidecar/mock-sidecar.mjs`
- Create: `tests/fixtures/sidecar/mock-sidecar-crash.mjs`
- Test: `tests/main/sidecar/sidecar-supervisor.test.ts`

- [ ] **Step 1: Create the mock sidecar (well-behaved) fixture**

Create `tests/fixtures/sidecar/mock-sidecar.mjs`:

```javascript
// Mock Swift sidecar for the supervisor test. It speaks the newline-delimited
// JSON protocol over stdio: on `start` it emits a `status` capturing event,
// one `audio` frame, and a `permission` event; on `screenshot` it emits a
// `screenshot` event; on `shutdown` it exits 0. Malformed input is ignored.
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    handleLine(line)
    index = buffer.indexOf('\n')
  }
})

function send(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`)
}

function handleLine(line) {
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  if (!command || typeof command.type !== 'string') return
  if (command.type === 'start') {
    send({ type: 'status', state: 'capturing', detail: 'Capture started.' })
    send({ type: 'permission', kind: 'mic', granted: true })
    send({ type: 'audio', source: 'mic', seq: 1, sampleRate: 16000, pcm: 'QUJD' })
  } else if (command.type === 'screenshot') {
    send({ type: 'screenshot', format: 'png', data: 'aW1n' })
  } else if (command.type === 'shutdown') {
    process.exit(0)
  }
}
```

- [ ] **Step 2: Create the mock sidecar (crashing) fixture**

Create `tests/fixtures/sidecar/mock-sidecar-crash.mjs`:

```javascript
// Mock Swift sidecar that crashes shortly after starting, to exercise the
// supervisor's restart-with-backoff path. It emits one status line so the
// supervisor sees it come up, then exits non-zero after a short delay.
process.stdout.write(
  `${JSON.stringify({ type: 'status', state: 'capturing', detail: 'up briefly' })}\n`
)
setTimeout(() => {
  process.exit(1)
}, 50)
```

- [ ] **Step 3: Write the failing test**

Create `tests/main/sidecar/sidecar-supervisor.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { createSidecarSupervisor } from '../../../src/main/sidecar/sidecar-supervisor'

const FIXTURES = join(__dirname, '../../fixtures/sidecar')

function makeCallbacks() {
  return {
    onAudio: vi.fn(),
    onScreenshot: vi.fn(),
    onStatus: vi.fn(),
    onPermission: vi.fn()
  }
}

describe('createSidecarSupervisor', () => {
  it('spawns the sidecar and routes a status event to onStatus', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => {
      expect(callbacks.onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'capturing' })
      )
    })
    await supervisor.shutdown()
  })

  it('routes an audio event to onAudio after start', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => {
      expect(callbacks.onAudio).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'mic', pcm: 'QUJD' })
      )
    })
    await supervisor.shutdown()
  })

  it('delivers a screenshot event to onScreenshot when requestScreenshot is called', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => expect(callbacks.onStatus).toHaveBeenCalled())
    supervisor.requestScreenshot()
    await vi.waitFor(() => {
      expect(callbacks.onScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'png', dataBase64: 'aW1n' })
      )
    })
    await supervisor.shutdown()
  })

  it('emits a paused status and restarts when the sidecar crashes', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar-crash.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    // The crash fixture exits 1, so the supervisor emits a paused status and
    // schedules a restart. Wait for the paused status to appear at least once.
    await vi.waitFor(() => {
      expect(callbacks.onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'paused' })
      )
    })
    await supervisor.shutdown()
  })

  it('does not restart after an intentional shutdown', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => expect(callbacks.onStatus).toHaveBeenCalled())
    await supervisor.shutdown()
    callbacks.onStatus.mockClear()
    // Give any erroneous restart time to fire.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(callbacks.onStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: 'capturing' })
    )
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test -- tests/main/sidecar/sidecar-supervisor.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/sidecar/sidecar-supervisor'`.

- [ ] **Step 5: Write the implementation**

Create `src/main/sidecar/sidecar-supervisor.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { splitLines } from '../codex/line-splitter'
import { backoffDelayMs } from './backoff'
import {
  parseSidecarLine,
  encodeSidecarCommand,
  type SidecarEvent
} from './sidecar-protocol'
import type { SidecarStatusPayload, ScreenshotPayload } from '../../shared/types'

/** A decoded audio frame handed to the supervisor's audio callback. */
export interface SidecarAudioFrame {
  source: 'system' | 'mic'
  seq: number
  sampleRate: number
  pcm: string
}

/** A decoded permission report handed to the permission callback. */
export interface SidecarPermission {
  kind: 'screen' | 'mic'
  granted: boolean
}

export interface SidecarSupervisorDeps {
  /** The sidecar binary, or `node` in tests. */
  command: string
  /** Args inserted before any sidecar args (the mock script path in tests). */
  prefixArgs: string[]
  /** The app bundle id, sent on `start` so the sidecar excludes own windows. */
  appBundleId: string
  /** Backoff base delay in ms. */
  baseBackoffMs: number
  /** Backoff cap in ms. */
  maxBackoffMs: number
  /** A process up at least this long resets the backoff counter. */
  stableUptimeMs: number
  /** Called with every decoded audio frame. */
  onAudio: (frame: SidecarAudioFrame) => void
  /** Called with every decoded screenshot. */
  onScreenshot: (screenshot: ScreenshotPayload) => void
  /** Called with every supervisor or sidecar status change. */
  onStatus: (status: SidecarStatusPayload) => void
  /** Called with every decoded permission report. */
  onPermission: (permission: SidecarPermission) => void
}

export interface SidecarSupervisor {
  /** Spawns the sidecar and begins capture. Idempotent. */
  start: () => void
  /** Asks the running sidecar for one screenshot. No-op when not running. */
  requestScreenshot: () => void
  /** Stops capture and terminates the sidecar without restarting it. */
  shutdown: () => Promise<void>
}

// Spawns and supervises the Swift capture sidecar. It frames the child's
// stdout with the shared splitLines buffer, parses each line with the pure
// parseSidecarLine, and routes events to the injected callbacks. On an
// unexpected exit it emits a 'paused' status and respawns with exponential
// backoff; an intentional shutdown suppresses the restart. Mirrors the
// whisper-runner.ts error-handling shape (error handler bound before stdio).
export function createSidecarSupervisor(deps: SidecarSupervisorDeps): SidecarSupervisor {
  let child: ChildProcess | null = null
  let stdoutBuffer = ''
  let restartAttempt = 0
  let restartTimer: NodeJS.Timeout | null = null
  let stableTimer: NodeJS.Timeout | null = null
  let intentionalStop = false
  let started = false

  function routeEvent(event: SidecarEvent): void {
    switch (event.kind) {
      case 'audio':
        deps.onAudio({
          source: event.source,
          seq: event.seq,
          sampleRate: event.sampleRate,
          pcm: event.pcm
        })
        return
      case 'screenshot':
        deps.onScreenshot({ format: 'png', dataBase64: event.dataBase64 })
        return
      case 'status':
        deps.onStatus({ state: stateOf(event.state), detail: event.detail })
        return
      case 'permission':
        deps.onPermission({ kind: event.permissionKind, granted: event.granted })
        return
      case 'ignored':
        return
    }
  }

  // Narrows the sidecar's free-form status string to the IPC payload union.
  function stateOf(raw: string): SidecarStatusPayload['state'] {
    if (raw === 'capturing' || raw === 'stopped' || raw === 'error') return raw
    return 'error'
  }

  function clearTimers(): void {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (stableTimer) {
      clearTimeout(stableTimer)
      stableTimer = null
    }
  }

  function writeCommand(line: string): void {
    if (child && child.stdin && !child.stdin.destroyed) {
      child.stdin.write(line)
    }
  }

  function spawnChild(): void {
    stdoutBuffer = ''
    const proc = spawn(deps.command, [...deps.prefixArgs], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child = proc

    // Bind the error handler before touching stdio: on a spawn failure the
    // streams can be null and the failure arrives through this event.
    proc.on('error', (err: Error) => {
      deps.onStatus({ state: 'error', detail: `Sidecar failed to start: ${err.message}` })
      scheduleRestart()
    })

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        const split = splitLines(stdoutBuffer, chunk)
        stdoutBuffer = split.rest
        for (const line of split.lines) {
          routeEvent(parseSidecarLine(line))
        }
      })
    }

    // stderr is internal-only diagnostic detail; it is not surfaced, matching
    // the whisper-runner and codex-runner policy of never leaking raw stderr.
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', () => {})
    }

    proc.on('close', () => {
      child = null
      if (intentionalStop) return
      deps.onStatus({ state: 'paused', detail: 'Audio paused, reconnecting capture...' })
      scheduleRestart()
    })

    // A process that stays up past the stable threshold resets the backoff.
    stableTimer = setTimeout(() => {
      restartAttempt = 0
    }, deps.stableUptimeMs)

    // Begin capture immediately on every (re)spawn.
    writeCommand(
      encodeSidecarCommand({
        type: 'start',
        capture: ['systemAudio', 'mic'],
        appBundleId: deps.appBundleId
      })
    )
  }

  function scheduleRestart(): void {
    if (intentionalStop) return
    restartAttempt += 1
    const delay = backoffDelayMs(restartAttempt, deps.baseBackoffMs, deps.maxBackoffMs)
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!intentionalStop) spawnChild()
    }, delay)
  }

  function start(): void {
    if (started) return
    started = true
    intentionalStop = false
    spawnChild()
  }

  function requestScreenshot(): void {
    writeCommand(encodeSidecarCommand({ type: 'screenshot' }))
  }

  async function shutdown(): Promise<void> {
    intentionalStop = true
    clearTimers()
    const proc = child
    if (!proc) return
    writeCommand(encodeSidecarCommand({ type: 'shutdown' }))
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      proc.once('close', done)
      // If the sidecar does not exit promptly, force it.
      setTimeout(() => {
        if (!settled) proc.kill('SIGKILL')
        done()
      }, 1_000)
    })
    child = null
  }

  return { start, requestScreenshot, shutdown }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- tests/main/sidecar/sidecar-supervisor.test.ts`
Expected: PASS, all 5 cases green.

- [ ] **Step 7: Commit**

```bash
git add src/main/sidecar/sidecar-supervisor.ts tests/main/sidecar/sidecar-supervisor.test.ts tests/fixtures/sidecar/mock-sidecar.mjs tests/fixtures/sidecar/mock-sidecar-crash.mjs
git commit -m "feat: add sidecar supervisor with protocol routing and restart backoff"
```

---

## Task 10: IPC handlers without the renderer AudioFrame channel (T4.6)

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
    onStopTranscription: vi.fn()
  }
}

function makeIpc(): {
  ipcMain: { on: ReturnType<typeof vi.fn> }
  handlers: Record<string, (...args: unknown[]) => void>
} {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const ipcMain = {
    on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
      handlers[c] = l
    })
  }
  return { ipcMain, handlers }
}

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('forwards the request payload when the AskQuestion channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-1', question: 'hello' }
    handlers[IpcChannel.AskQuestion]({}, request)
    expect(deps.onAskQuestion).toHaveBeenCalledWith(request)
  })

  it('calls onStartTranscription when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StartTranscription]()
    expect(deps.onStartTranscription).toHaveBeenCalledOnce()
  })

  it('calls onStopTranscription when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StopTranscription]()
    expect(deps.onStopTranscription).toHaveBeenCalledOnce()
  })

  it('does not register the removed AudioFrame channel', () => {
    const { ipcMain, handlers } = makeIpc()
    registerIpcHandlers(ipcMain, makeDeps())
    expect(handlers['transcription:audio-frame']).toBeUndefined()
  })

  it('registers exactly four channel handlers', () => {
    const { ipcMain } = makeIpc()
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/ipc/ipc-handlers.test.ts`
Expected: FAIL: `registers exactly four channel handlers` expects 4 but the current code registers 5, and `does not register the removed AudioFrame channel` fails because the channel is still registered.

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
}

// Registers the renderer-to-main IPC channels. The Phase 3 AudioFrame channel
// is gone: in Phase 4 audio is captured by the Swift sidecar, so the renderer
// no longer produces PCM. Start/stop transcription now also drive the sidecar.
export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1])
  })
  ipcMain.on(IpcChannel.StartTranscription, () => deps.onStartTranscription())
  ipcMain.on(IpcChannel.StopTranscription, () => deps.onStopTranscription())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/ipc/ipc-handlers.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/ipc-handlers.ts tests/main/ipc/ipc-handlers.test.ts
git commit -m "refactor: remove renderer AudioFrame IPC channel"
```

---

## Task 11: Preload API for sidecar status and screenshots (T4.5, T4.6)

**Files:**
- Modify: `src/preload/api.ts`
- Modify: `tests/preload/api.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the `createOverlayApi transcription methods` describe block in `tests/preload/api.test.ts` with the block below. Keep all other existing imports and cases in the file. If the file imports shared payload types, update that import to drop `AudioFramePayload` and add `SidecarStatusPayload` and `ScreenshotPayload`.

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createOverlayApi, type IpcRendererLike } from '../../src/preload/api'
import { IpcChannel } from '../../src/shared/types'

describe('createOverlayApi transcription and sidecar methods', () => {
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

  it('does not expose a sendAudioFrame method', () => {
    const ipc = makeIpc()
    expect(
      (createOverlayApi(ipc) as Record<string, unknown>).sendAudioFrame
    ).toBeUndefined()
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

  it('onSidecarStatus subscribes to the SidecarStatus channel', () => {
    const ipc = makeIpc()
    const received: unknown[] = []
    createOverlayApi(ipc).onSidecarStatus((payload) => received.push(payload))
    ipc.listeners[IpcChannel.SidecarStatus]({}, { state: 'paused', detail: 'reconnecting' })
    expect(received).toEqual([{ state: 'paused', detail: 'reconnecting' }])
  })

  it('onScreenshot subscribes to the Screenshot channel', () => {
    const ipc = makeIpc()
    const received: unknown[] = []
    createOverlayApi(ipc).onScreenshot((payload) => received.push(payload))
    ipc.listeners[IpcChannel.Screenshot]({}, { format: 'png', dataBase64: 'aW1n' })
    expect(received).toEqual([{ format: 'png', dataBase64: 'aW1n' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/preload/api.test.ts`
Expected: FAIL: `onSidecarStatus` and `onScreenshot` are not functions on the returned API, and the `does not expose a sendAudioFrame method` case fails because `sendAudioFrame` still exists.

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
  type TranscriptUpdatePayload,
  type TranscriptionStatusPayload,
  type SidecarStatusPayload,
  type ScreenshotPayload
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
  onTranscriptUpdate(callback: (update: TranscriptUpdatePayload) => void): () => void
  onTranscriptionStatus(callback: (status: TranscriptionStatusPayload) => void): () => void
  onSidecarStatus(callback: (status: SidecarStatusPayload) => void): () => void
  onScreenshot(callback: (screenshot: ScreenshotPayload) => void): () => void
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
    onTranscriptUpdate: (callback) => subscribe(IpcChannel.TranscriptUpdate, callback),
    onTranscriptionStatus: (callback) => subscribe(IpcChannel.TranscriptionStatus, callback),
    onSidecarStatus: (callback) => subscribe(IpcChannel.SidecarStatus, callback),
    onScreenshot: (callback) => subscribe(IpcChannel.Screenshot, callback)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/preload/api.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/preload/api.ts tests/preload/api.test.ts
git commit -m "feat: expose sidecar status and screenshot subscriptions on the preload API"
```

---

## Task 12: Remove the renderer getUserMedia path and update useTranscript (T4.6)

**Files:**
- Delete: `src/renderer/src/audio/mic-capture.ts`
- Delete: `src/renderer/src/audio/pcm-worklet.ts`
- Delete: `src/renderer/src/audio/downsample.ts`
- Delete: `tests/renderer/audio/downsample.test.ts`
- Modify: `src/renderer/src/hooks/useTranscript.ts`
- Modify: `tests/renderer/hooks/useTranscript.test.ts`

- [ ] **Step 1: Delete the Phase 3 renderer audio stopgap**

Run:

```bash
git rm src/renderer/src/audio/mic-capture.ts src/renderer/src/audio/pcm-worklet.ts src/renderer/src/audio/downsample.ts tests/renderer/audio/downsample.test.ts
rmdir src/renderer/src/audio tests/renderer/audio 2>/dev/null || true
```

Expected: the four files are removed; the now-empty `src/renderer/src/audio` and `tests/renderer/audio` directories are deleted if empty.

- [ ] **Step 2: Write the failing test**

Replace the entire contents of `tests/renderer/hooks/useTranscript.test.ts` with:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTranscript } from '../../../src/renderer/src/hooks/useTranscript'
import type {
  TranscriptUpdatePayload,
  TranscriptionStatusPayload,
  SidecarStatusPayload
} from '../../../src/shared/types'

type Cb<T> = (payload: T) => void

let updateCb: Cb<TranscriptUpdatePayload> = () => {}
let statusCb: Cb<TranscriptionStatusPayload> = () => {}
let sidecarCb: Cb<SidecarStatusPayload> = () => {}
let started = 0
let stopped = 0

beforeEach(() => {
  updateCb = () => {}
  statusCb = () => {}
  sidecarCb = () => {}
  started = 0
  stopped = 0
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
    onTranscriptUpdate: vi.fn((cb: Cb<TranscriptUpdatePayload>) => {
      updateCb = cb
      return () => {}
    }),
    onTranscriptionStatus: vi.fn((cb: Cb<TranscriptionStatusPayload>) => {
      statusCb = cb
      return () => {}
    }),
    onSidecarStatus: vi.fn((cb: Cb<SidecarStatusPayload>) => {
      sidecarCb = cb
      return () => {}
    }),
    onScreenshot: vi.fn(() => () => {})
  }
})

describe('useTranscript', () => {
  it('starts with no segments, not listening, not ready, and not paused', () => {
    const { result } = renderHook(() => useTranscript())
    expect(result.current.segments).toEqual([])
    expect(result.current.listening).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.audioPaused).toBe(false)
  })

  it('does not start transcription on mount', () => {
    renderHook(() => useTranscript())
    expect(started).toBe(0)
  })

  it('updates segments when a transcript update arrives', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => updateCb({ segments: [{ id: '1', speaker: 'them', text: 'hello' }] }))
    expect(result.current.segments).toEqual([{ id: '1', speaker: 'them', text: 'hello' }])
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

  it('sets audioPaused true when the sidecar reports a paused state', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => sidecarCb({ state: 'paused', detail: 'reconnecting' }))
    expect(result.current.audioPaused).toBe(true)
  })

  it('clears audioPaused when the sidecar reports capturing again', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => sidecarCb({ state: 'paused', detail: 'reconnecting' }))
    act(() => sidecarCb({ state: 'capturing', detail: 'ok' }))
    expect(result.current.audioPaused).toBe(false)
  })

  it('startListening sets listening true and notifies the bridge only', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    expect(result.current.listening).toBe(true)
    expect(started).toBe(1)
  })

  it('stopListening sets listening false and notifies the bridge', () => {
    const { result } = renderHook(() => useTranscript())
    act(() => result.current.startListening())
    act(() => result.current.stopListening())
    expect(result.current.listening).toBe(false)
    expect(stopped).toBe(1)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/hooks/useTranscript.test.ts`
Expected: FAIL: `useTranscript` still imports the deleted `../audio/mic-capture`, so the module fails to resolve, and `audioPaused` is not on the hook result.

- [ ] **Step 4: Write the implementation**

Replace the entire contents of `src/renderer/src/hooks/useTranscript.ts` with:

```typescript
import { useCallback, useEffect, useState } from 'react'
import type {
  TranscriptSegment,
  TranscriptUpdatePayload,
  TranscriptionStatusPayload,
  SidecarStatusPayload
} from '../../../shared/types'

export interface UseTranscript {
  segments: TranscriptSegment[]
  ready: boolean
  statusDetail: string
  /** True while a listening session is active. */
  listening: boolean
  /** True while the capture sidecar is down and being restarted. */
  audioPaused: boolean
  /** Begins a listening session: tells main to start sidecar capture. */
  startListening: () => void
  /** Ends the listening session: tells main to stop sidecar capture. */
  stopListening: () => void
}

// Renderer-side transcription controller. In Phase 4 the renderer no longer
// captures audio: the Swift sidecar does. startListening/stopListening only
// notify the main process, which drives the sidecar supervisor. The hook
// subscribes to transcript updates, transcription status, and sidecar status
// (the last surfaces the "audio paused" banner while a crashed sidecar
// restarts).
export function useTranscript(): UseTranscript {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [ready, setReady] = useState(false)
  const [statusDetail, setStatusDetail] = useState('')
  const [listening, setListening] = useState(false)
  const [audioPaused, setAudioPaused] = useState(false)

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
    const offSidecar = window.customcluely.onSidecarStatus(
      (status: SidecarStatusPayload) => {
        setAudioPaused(status.state === 'paused')
      }
    )
    return () => {
      offUpdate()
      offStatus()
      offSidecar()
    }
  }, [])

  const startListening = useCallback(() => {
    setListening(true)
    window.customcluely.startTranscription()
  }, [])

  const stopListening = useCallback(() => {
    setListening(false)
    window.customcluely.stopTranscription()
  }, [])

  return {
    segments,
    ready,
    statusDetail,
    listening,
    audioPaused,
    startListening,
    stopListening
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/hooks/useTranscript.test.ts`
Expected: PASS, all 9 cases green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS now. The `AudioFramePayload` removal from Task 2 is resolved: every consumer (`api.ts`, `ipc-handlers.ts`, `transcription-service.ts`, `useTranscript.ts`) has been updated. If `index.ts` still imports a removed symbol it is fixed in Task 13; if typecheck fails only inside `src/main/index.ts`, that is expected and Task 13 resolves it. Any other failure must be fixed before committing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/hooks/useTranscript.ts tests/renderer/hooks/useTranscript.test.ts src/renderer/src/audio tests/renderer/audio
git commit -m "refactor: remove renderer getUserMedia capture path, drive sidecar from useTranscript"
```

---

## Task 13: Wire the sidecar into Electron main (T4.5, T4.7)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `tests/renderer/App.test.tsx`

- [ ] **Step 1: Write the failing renderer test for the audio-paused banner**

Replace the `App live transcript wiring` describe block in `tests/renderer/App.test.tsx` with the block below. Keep all other existing imports and cases. Every App test block that builds its own `window.customcluely` mock must be updated to the Phase 4 bridge surface (the methods used below); update those mocks in this step so only the intended assertions can fail.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import type { TranscriptUpdatePayload, SidecarStatusPayload } from '../../src/shared/types'

describe('App live transcript and sidecar wiring', () => {
  let updateCb: (p: TranscriptUpdatePayload) => void = () => {}
  let sidecarCb: (p: SidecarStatusPayload) => void = () => {}

  beforeEach(() => {
    updateCb = () => {}
    sidecarCb = () => {}
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
      onTranscriptUpdate: vi.fn((cb: (p: TranscriptUpdatePayload) => void) => {
        updateCb = cb
        return () => {}
      }),
      onTranscriptionStatus: vi.fn(() => () => {}),
      onSidecarStatus: vi.fn((cb: (p: SidecarStatusPayload) => void) => {
        sidecarCb = cb
        return () => {}
      }),
      onScreenshot: vi.fn(() => () => {})
    }
  })

  it('renders a transcript segment pushed from the main process', () => {
    render(<App />)
    act(() => updateCb({ segments: [{ id: 's1', speaker: 'them', text: 'system audio line' }] }))
    expect(screen.getByText('system audio line')).toBeInTheDocument()
  })

  it('renders a Start listening control and does not auto-start listening', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Listening: off' })).toBeInTheDocument()
    expect(window.customcluely.startTranscription).not.toHaveBeenCalled()
  })

  it('shows an audio-paused banner when the sidecar reports a paused state', () => {
    render(<App />)
    act(() => sidecarCb({ state: 'paused', detail: 'Audio paused, reconnecting capture...' }))
    expect(screen.getByText('Audio paused, reconnecting capture...')).toBeInTheDocument()
  })

  it('does not show the audio-paused banner while the sidecar is capturing', () => {
    render(<App />)
    act(() => sidecarCb({ state: 'capturing', detail: 'ok' }))
    expect(screen.queryByText('Audio paused, reconnecting capture...')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/App.test.tsx`
Expected: FAIL: `App` does not render an audio-paused banner, so `getByText('Audio paused, reconnecting capture...')` throws not-found.

- [ ] **Step 3: Update `src/renderer/src/App.tsx`**

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
  const { segments, listening, audioPaused, startListening, stopListening } = useTranscript()

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
      {audioPaused && (
        <p className="app__audio-paused" role="status">
          Audio paused, reconnecting capture...
        </p>
      )}
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

- [ ] **Step 4: Run the renderer test to verify it passes**

Run: `npm run test -- tests/renderer/App.test.tsx`
Expected: PASS, the four cases and all existing App cases green.

- [ ] **Step 5: Update `src/main/index.ts` to wire the sidecar**

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
import { resolveSidecarPath } from './transcription/resolve-sidecar-path'
import { downloadModel, type HttpResponse } from './transcription/model-downloader'
import { createTranscriptionService } from './transcription/transcription-service'
import { runWhisper } from './transcription/whisper-runner'
import { createSidecarSupervisor } from './sidecar/sidecar-supervisor'
import { MOVE_STEP_PX, CODEX, WHISPER, SIDECAR } from './config/constants'
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
// injected HttpResponse shape. This is the only network call in the app.
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
  electronApp.setAppUserModelId(SIDECAR.appBundleId)
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

  // Resolve the bundled native assets. In a packaged app the resources live
  // under process.resourcesPath; in dev they live under the repo `resources`.
  const resourcesRoot = is.dev ? join(app.getAppPath(), 'resources') : process.resourcesPath
  const whisperPaths = resolveWhisperPaths({ resourcesRoot, fileExists: existsSync })
  const sidecarPaths = resolveSidecarPath({ resourcesRoot, fileExists: existsSync })

  const transcriptionService = createTranscriptionService({
    emit: emitToOverlay,
    runWhisper,
    modelPath: whisperPaths.modelPath,
    command: whisperPaths.binaryPath
  })

  // The Swift capture sidecar: it captures system audio and the microphone,
  // takes screenshots, and is supervised with restart-on-crash. Its audio
  // frames are routed straight into the transcription service with the
  // matching capture source so the speaker hint is correct.
  const sidecar = createSidecarSupervisor({
    command: sidecarPaths.binaryPath,
    prefixArgs: [],
    appBundleId: SIDECAR.appBundleId,
    baseBackoffMs: SIDECAR.baseBackoffMs,
    maxBackoffMs: SIDECAR.maxBackoffMs,
    stableUptimeMs: SIDECAR.stableUptimeMs,
    onAudio: (frame) => {
      void transcriptionService.handleAudioFrame({ pcmBase64: frame.pcm }, frame.source)
    },
    onScreenshot: (screenshot) => emitToOverlay(IpcChannel.Screenshot, screenshot),
    onStatus: (status) => emitToOverlay(IpcChannel.SidecarStatus, status),
    onPermission: (permission) => {
      // A denied permission is surfaced through the sidecar status channel so
      // the renderer can show a banner that deep-links to System Settings.
      if (!permission.granted) {
        const pane =
          permission.kind === 'screen'
            ? 'Screen Recording'
            : 'Microphone'
        emitToOverlay(IpcChannel.SidecarStatus, {
          state: 'error',
          detail: `${pane} permission is denied. Grant it to Customcluely in System Settings > Privacy & Security > ${pane}.`
        })
      }
    }
  })

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request) => {
      void codexService.handleAsk(request)
    },
    // Starting a listening session resets the rolling audio state and starts
    // the Swift sidecar capturing system audio and the microphone.
    onStartTranscription: () => {
      transcriptionService.reset()
      sidecar.start()
    },
    // Stopping clears the rolling state. The sidecar keeps running so a
    // restart is fast; it is fully shut down only on app quit.
    onStopTranscription: () => {
      transcriptionService.reset()
    }
  })

  void checkCodexAvailability({
    getVersion: () => getCodexVersion(codexPath),
    authFileExists: () => existsSync(join(homedir(), '.codex', 'auth.json'))
  }).then((status) => emitToOverlay(IpcChannel.CodexStatus, status))

  // Report sidecar availability so the renderer can warn if the binary is
  // missing (it must be built by scripts/setup-sidecar.sh).
  if (!sidecarPaths.binaryPresent) {
    emitToOverlay(IpcChannel.SidecarStatus, {
      state: 'error',
      detail: 'The capture sidecar is missing. Run scripts/setup-sidecar.sh.'
    })
  }

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

  // Shut the sidecar down cleanly before the app exits.
  app.on('will-quit', () => {
    void sidecar.shutdown()
  })
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm run test`
Expected: PASS, every test file green.

Run: `npm run typecheck`
Expected: PASS, no type errors in node or web projects.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/renderer/src/App.tsx tests/renderer/App.test.tsx
git commit -m "feat: wire the Swift capture sidecar into Electron main with audio-paused banner"
```

---

## Task 14: Phase 4 verification (T4.8)

**Files:**
- Create: `docs/superpowers/verification/2026-05-20-phase-4.md`

- [ ] **Step 1: Write the verification document**

Create `docs/superpowers/verification/2026-05-20-phase-4.md`:

```markdown
# Phase 4 Verification: Swift Capture Sidecar

**Phase goal:** Native macOS system-audio capture and on-demand screenshots, streamed to Electron over stdio, supervised with restart.
**Acceptance:** Audio from another macOS app is captured and transcribed, and a screenshot can be attached to a Codex query.

## Automated checks

Run each command from the repository root. All must pass.

| # | Command | Expected |
|---|---------|----------|
| 1 | `swift test --package-path sidecar` | All StdioProtocolTests cases pass. |
| 2 | `swift build -c release --package-path sidecar` | Release build succeeds, produces `sidecar/.build/release/customcluely-sidecar`. |
| 3 | `npm run test` | All test files pass, including every `tests/main/sidecar/*`, the updated `tests/main/transcription/transcription-service.test.ts`, the updated `tests/main/ipc/ipc-handlers.test.ts`, `tests/preload/api.test.ts`, `tests/renderer/hooks/useTranscript.test.ts`, and `tests/renderer/App.test.tsx`. |
| 4 | `npm run typecheck` | No type errors in node or web projects. |
| 5 | `npm run lint` | No lint errors. |
| 6 | `npm run build` | electron-vite build succeeds. |
| 7 | `test -x resources/sidecar/customcluely-sidecar && echo OK` | Prints `OK` (the bundled sidecar binary exists and is executable). |
| 8 | `git ls-files resources/sidecar` | Lists `resources/sidecar/.gitkeep` and `resources/sidecar/customcluely-sidecar`. |
| 9 | `git ls-files src/renderer/src/audio` | Prints nothing (the Phase 3 getUserMedia stopgap is fully removed). |

## T4.x roadmap coverage

| Roadmap item | Implemented by |
|---|---|
| T4.1 Swift package scaffold and StdioProtocol codec | Task 1 (`sidecar/Package.swift`, `SidecarCore/ProtocolMessages.swift`, `SidecarCore/StdioProtocol.swift`, `StdioProtocolTests.swift`), Task 7 (`scripts/setup-sidecar.sh`, bundled binary). |
| T4.2 System audio capture (ScreenCaptureKit SCStream) | Task 6 (`SystemAudioCapture.swift`, `AudioResampler.swift`). |
| T4.3 Microphone capture (AVAudioEngine) in the sidecar | Task 6 (`MicrophoneCapture.swift`, `AudioResampler.swift`). |
| T4.4 Screenshot capture excluding the overlay window | Task 6 (`ScreenCapture.swift`, `CaptureCoordinator.swift` screenshot path; the `SCContentFilter(display:excludingWindows:)` exclusion uses the app bundle id). |
| T4.5 Sidecar supervisor in Electron main | Task 2 (SIDECAR constants, channels), Task 3 (`sidecar-protocol.ts`), Task 4 (`backoff.ts`), Task 5 (`resolve-sidecar-path.ts`), Task 9 (`sidecar-supervisor.ts`), Task 13 (`index.ts` wiring, audio routed into `TranscriptionService`, "audio paused" surfaced). |
| T4.6 Migrate audio source from renderer getUserMedia to the sidecar | Task 8 (per-source `you`/`them` routing), Task 10 (drop the `AudioFrame` channel), Task 11 (drop `sendAudioFrame`), Task 12 (delete `mic-capture.ts`/`pcm-worklet.ts`/`downsample.ts`, rewrite `useTranscript.ts`), Task 13 (`App.tsx`). |
| T4.7 macOS permissions handling | Task 6 (`Permissions.swift`, `CaptureCoordinator` permission reports), Task 13 (`index.ts` `onPermission` surfaces a deep-link banner). |
| T4.8 Phase 4 verification | This document. |

## Dev-time TCC caveat (design spec section 19)

A plain command-line binary that is not inside a properly structured `.app`
bundle does not appear by name in System Settings to Screen Recording, even
though it still receives and honors the permission once granted. The sidecar
runs as a child process of the Electron `.app`, so the Screen Recording and
Microphone permissions attach to the parent app's code-signing identity, and
"Customcluely" (the Electron app) is what the user grants. v1 does not build a
separate notarized helper bundle (out of scope). The manual checklist below
includes the one-time grant step. Ad-hoc rebuilds of the Swift binary alone do
not change the parent app identity, so the grant persists across sidecar
rebuilds.

## Manual checklist

Perform these on macOS arm64 with a working microphone and a second app that
plays audio (a video, a call, a music app).

- [ ] Run `bash scripts/setup-sidecar.sh` once; confirm `resources/sidecar/customcluely-sidecar` exists and is executable.
- [ ] Run `npm run dev`. On first launch, click "Start listening".
- [ ] Grant the macOS Microphone permission prompt when it appears (granted to "Customcluely").
- [ ] Grant the macOS Screen Recording permission when prompted; if no prompt appears, open System Settings > Privacy & Security > Screen Recording, enable "Customcluely", and restart the app.
- [ ] Confirm the overlay does not show the "audio paused" banner while the sidecar is running.
- [ ] Speak into the microphone for at least 15 seconds; confirm transcript lines appear labelled with the `you` speaker.
- [ ] Play audio from the second app (a video or a call) for at least 15 seconds; confirm transcript lines appear labelled with the `them` speaker. This is the Phase 4 acceptance check for system-audio capture.
- [ ] Trigger a screenshot (via the Phase 5 screenshot path or a temporary dev hook that calls `requestScreenshot`); confirm a screenshot is delivered and that it does NOT contain the Customcluely overlay window.
- [ ] Find the sidecar process (`pgrep customcluely-sidecar`) and kill it (`kill -9 <pid>`); confirm the overlay shows the "audio paused" banner, then confirm it clears within ~8 seconds as the supervisor restarts the sidecar and capture resumes.
- [ ] Quit the app; confirm the sidecar process is no longer running (`pgrep customcluely-sidecar` prints nothing).
- [ ] **No-network check:** with the model already downloaded, run `nettop -p <electron pid>` while capturing; confirm capture and transcription produce no outbound network traffic (Phase 4 introduces no network calls).
- [ ] Deny the Microphone or Screen Recording permission in System Settings, restart the app, click "Start listening", and confirm a banner appears that names the permission and points to the correct System Settings pane.

## Sign-off

Phase 4 is complete when every automated check passes and every manual
checklist item is confirmed, in particular the acceptance check: audio from
another macOS app is captured and transcribed as a `them` segment.
```

- [ ] **Step 2: Run all automated checks listed in the doc**

Run: `swift test --package-path sidecar && swift build -c release --package-path sidecar && npm run test && npm run typecheck && npm run lint && npm run build`
Expected: every command exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/verification/2026-05-20-phase-4.md
git commit -m "docs: add Phase 4 sidecar verification"
```

---

## Self-review

This plan has **14 tasks**.

**1. Spec and roadmap coverage.** Every Phase 4 roadmap item (T4.1 to T4.8) maps to at least one task:

- **T4.1 Swift package scaffold and StdioProtocol codec:** Task 1 scaffolds `sidecar/Package.swift` (`.macOS(.v14)`, the `SidecarCore` library target, the `customcluely-sidecar` executable target, the `SidecarCoreTests` test target) and implements the pure, unit-tested `StdioProtocol` codec with 13 XCTest cases. Task 7 adds the build script and the committed binary.
- **T4.2 System audio capture:** Task 6 implements `SystemAudioCapture.swift` with a ScreenCaptureKit `SCStream`, `SCStreamConfiguration.capturesAudio = true`, `SCContentFilter(display:excludingWindows:)`, and `AudioResampler` normalization to 16 kHz mono 16-bit PCM.
- **T4.3 Microphone capture in the sidecar:** Task 6 implements `MicrophoneCapture.swift` with an `AVAudioEngine` input-node tap and the same `AudioResampler`.
- **T4.4 Screenshot capture excluding the overlay:** Task 6 implements `ScreenCapture.swift` with `SCScreenshotManager.captureImage`, using the same `excludingWindows` filter built from the app bundle id, and PNG encoding.
- **T4.5 Sidecar supervisor in Electron main:** Task 2 (SIDECAR constants, `SidecarStatus`/`Screenshot` channels, `SidecarStatusPayload`), Task 3 (the pure `sidecar-protocol.ts` parser, unit-tested with a never-throws guarantee), Task 4 (the pure `backoff.ts`, unit-tested), Task 5 (`resolve-sidecar-path.ts`, unit-tested), Task 9 (`sidecar-supervisor.ts`: spawn, restart with backoff, protocol parsing, unit-tested against a mock sidecar including the crash-and-restart path), Task 13 (`index.ts` routes `audio` events into `TranscriptionService.handleAudioFrame`, emits the "audio paused" status). The spec's "UI shows audio paused until the sidecar recovers" is covered: the supervisor emits `state: 'paused'` on an unexpected `close`, and `useTranscript`/`App.tsx` render the banner.
- **T4.6 Migrate audio source from renderer getUserMedia to the sidecar:** Task 8 makes `TranscriptionService.handleAudioFrame` per-source and gives system audio the `them` speaker and the mic the `you` speaker. Task 10 removes the `AudioFrame` channel; Task 11 removes `sendAudioFrame`; Task 12 deletes `mic-capture.ts`, `pcm-worklet.ts`, `downsample.ts`, and `downsample.test.ts`, and rewrites `useTranscript.ts` so `startListening`/`stopListening` only notify the bridge; Task 13's `App.tsx` keeps the `ListenToggle` driving start/stop. The decision section records exactly what is deleted versus kept.
- **T4.7 macOS permissions handling:** Task 6's `Permissions.swift` checks and requests Screen Recording (`CGPreflightScreenCaptureAccess`/`CGRequestScreenCaptureAccess`) and Microphone (`AVCaptureDevice.authorizationStatus`/`requestAccess`), and `CaptureCoordinator` emits `permission` events. Task 13's `onPermission` surfaces a denial banner that deep-links to the correct System Settings pane. The dev-time TCC caveat from spec section 19 is recorded in the Decisions section and the verification doc.
- **T4.8 Phase 4 verification:** Task 14 creates the verification doc with 9 automated checks, the roadmap-coverage table, the TCC caveat, and a manual checklist whose acceptance item is system audio from another app captured and transcribed as a `them` segment, plus the screenshot-excludes-overlay check.

The stdio protocol from spec section 11 is implemented exactly: main-to-sidecar `start`/`screenshot`/`stop`/`shutdown` (Swift `SidecarCommand`, TS `SidecarCommand`/`encodeSidecarCommand`) and sidecar-to-main `audio`/`screenshot`/`status`/`permission` (Swift `SidecarEvent`/`StdioProtocol.encodeEvent`, TS `SidecarEvent`/`parseSidecarLine`). Malformed-line tolerance is implemented on both sides (Swift `decodeCommand` returns nil; TS `parseSidecarLine` returns `{ kind: 'ignored' }`); neither throws. Scope is not expanded: there is no transcript summarization, no Default Actions, no dynamic insights, no session manager (Phase 5). The screenshot path is built and delivered to a `Screenshot` IPC channel, which is exactly what the acceptance criterion ("a screenshot can be attached to a Codex query") requires Phase 4 to provide; actually attaching it to a Codex query is Phase 5 (T5.2).

**2. Placeholder scan.** No `TODO`, `TBD`, `implement later`, `add error handling`, `similar to Task N`, or bare "write tests" placeholders. Every code step contains complete code. Task 1 includes a minimal `main.swift` so the executable target compiles before Task 6 replaces it; this is stated explicitly, not a placeholder. Task 6's capture units have no XCTest by design (they need real audio and screen hardware); this is stated, the pure codec carries the Swift unit coverage (Task 1), and the capture units are covered by the Task 14 manual checklist. Task 2's Step 6 explicitly notes that `npm run typecheck` fails between Tasks 2 and 12 because `AudioFramePayload` consumers are removed across several tasks, and names where it is resolved (Task 12, then Task 13 for `index.ts`); this is an intentional, documented multi-task refactor, not a missing step.

**3. Type and name consistency across tasks and the Swift/TS boundary.**

- Swift `SidecarCommand` cases (`start(capture:appBundleId:)`, `screenshot`, `stop`, `shutdown`) defined in Task 1 are produced by `StdioProtocol.decodeCommand` and consumed by `CaptureCoordinator.handle` in Task 6 with matching names.
- Swift `SidecarEvent` cases (`audio(source:seq:sampleRate:pcm:)`, `screenshot(format:data:)`, `status(state:detail:)`, `permission(kind:granted:)`) defined in Task 1 are produced by `CaptureCoordinator` in Task 6 and encoded by `StdioProtocol.encodeEvent`.
- The wire JSON keys match across the boundary: Swift `encodeEvent` writes `type`, `source`, `seq`, `sampleRate`, `pcm`, `format`, `data`, `state`, `detail`, `kind`, `granted`; TS `parseSidecarLine` (Task 3) reads exactly those keys. Swift `decodeCommand` reads `type`, `capture`, `appBundleId`; TS `encodeSidecarCommand` writes exactly those.
- TS `SidecarEvent` discriminated union (`kind: 'audio' | 'screenshot' | 'status' | 'permission' | 'ignored'`) defined in Task 3 is consumed by `sidecar-supervisor.ts` `routeEvent` in Task 9 with matching `kind` values, and `routeEvent`'s `event.source`/`event.seq`/`event.sampleRate`/`event.pcm`/`event.dataBase64`/`event.permissionKind`/`event.granted` field names match the Task 3 union exactly.
- `SidecarStatusPayload` (`state: 'capturing' | 'paused' | 'stopped' | 'error'`, `detail`) and `ScreenshotPayload` (`format: 'png'`, `dataBase64`) defined in Task 2 are produced by `sidecar-supervisor.ts` (Task 9), emitted on `IpcChannel.SidecarStatus`/`IpcChannel.Screenshot` by `index.ts` (Task 13), subscribed by `api.ts` `onSidecarStatus`/`onScreenshot` (Task 11), and consumed by `useTranscript.ts` (Task 12, `audioPaused = status.state === 'paused'`).
- `SIDECAR` fields (`binaryName`, `appBundleId`, `captureSources`, `baseBackoffMs`, `maxBackoffMs`, `stableUptimeMs`) defined in Task 2 are read by `resolve-sidecar-path.ts` (Task 5, `binaryName`) and `index.ts` (Task 13, all six).
- `resolveSidecarPath` returns `{ binaryPath, binaryPresent }` (Task 5); `index.ts` reads exactly those two fields (Task 13).
- `backoffDelayMs(attempt, baseMs, maxMs)` (Task 4) is called with that signature by `sidecar-supervisor.ts` `scheduleRestart` (Task 9).
- `createSidecarSupervisor` deps (`command`, `prefixArgs`, `appBundleId`, `baseBackoffMs`, `maxBackoffMs`, `stableUptimeMs`, `onAudio`, `onScreenshot`, `onStatus`, `onPermission`) defined in Task 9 are supplied exactly by `index.ts` in Task 13; its returned API (`start`, `requestScreenshot`, `shutdown`) is used by `index.ts` (`sidecar.start()`, `sidecar.shutdown()`).
- `SidecarAudioFrame` (`source`, `seq`, `sampleRate`, `pcm`) from Task 9 is consumed by `index.ts` `onAudio` (Task 13): `transcriptionService.handleAudioFrame({ pcmBase64: frame.pcm }, frame.source)`.
- `TranscriptionService.handleAudioFrame(payload, source?)` with `AudioFrameSource = 'system' | 'mic'` (Task 8) matches the call site in Task 13 and the test calls in Task 8. The default `source = 'mic'` keeps it valid; `index.ts` always passes the source explicitly.
- `IpcHandlerDeps` (Task 10) drops `onAudioFrame`, keeps `onToggleInvisibility`, `onAskQuestion`, `onStartTranscription`, `onStopTranscription`; `index.ts` (Task 13) supplies exactly those four; the test asserts exactly four registrations.
- `OverlayApi` (Task 11) drops `sendAudioFrame`, adds `onSidecarStatus`/`onScreenshot`; `useTranscript.ts` (Task 12) uses `onSidecarStatus`, and the Task 12 and Task 13 test bridge mocks supply the full Phase 4 surface (`onSidecarStatus`, `onScreenshot`, no `sendAudioFrame`).
- `useTranscript` returns `{ segments, ready, statusDetail, listening, audioPaused, startListening, stopListening }` (Task 12); `App.tsx` (Task 13) destructures `{ segments, listening, audioPaused, startListening, stopListening }`, a consistent subset.
- The app bundle id is one value, `com.customcluely.app`, used identically in `SIDECAR.appBundleId` (Task 2), the Swift exclusion match (Task 6, passed via the `start` command), the supervisor test fixtures (Task 9), and `electronApp.setAppUserModelId(SIDECAR.appBundleId)` (Task 13).

No inconsistencies found. The plan is internally consistent across all 14 tasks and across the Swift and TypeScript sides of the protocol, and is ready for execution.
