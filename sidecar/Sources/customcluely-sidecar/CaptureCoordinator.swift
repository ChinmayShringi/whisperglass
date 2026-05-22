import Foundation
import SidecarCore

/// Owns the three capture units and the permission checks, and turns decoded
/// commands into actions. It is the single place that emits SidecarEvents
/// through the transport, so the audio sequence counters and the capture
/// status are consistent.
///
/// `@unchecked Sendable`: a detached `Task` references `self` for the on-demand
/// screenshot. The audio sequence counters are guarded by `seqLock`, and the
/// capture-unit references are only mutated from the single command path, so
/// no data race is possible.
final class CaptureCoordinator: @unchecked Sendable {
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
