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
