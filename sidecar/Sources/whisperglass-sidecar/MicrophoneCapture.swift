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
