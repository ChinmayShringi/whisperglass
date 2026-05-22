import Foundation
import ScreenCaptureKit
import AVFAudio

/// Captures macOS system audio with a ScreenCaptureKit SCStream. The stream's
/// SCContentFilter excludes every window owned by the host app's bundle id,
/// so the audio stream (and any screenshot built from the same filter) never
/// includes the app's own overlay. ScreenCaptureKit delivers 48 kHz stereo
/// Float32 audio sample buffers; each is resampled to 16 kHz mono 16-bit PCM.
///
/// `@unchecked Sendable`: the class is referenced from a detached `Task` for
/// stream setup and teardown. Its mutable `stream` property is only ever
/// touched from those serialized setup/stop paths and the immutable callbacks
/// are set once at init, so no data race is possible.
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
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
        // `SCStream` is not Sendable, but ownership transfers cleanly here:
        // `self.stream` was just nilled, so this local binding is the only
        // remaining reference when the detached task awaits stopCapture().
        nonisolated(unsafe) let stoppingStream = stream
        Task { try? await stoppingStream.stopCapture() }
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
