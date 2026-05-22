import Foundation
// `@preconcurrency`: AVFAudio predates Swift 6 concurrency. AVAudioConverter's
// input block is typed `@Sendable`, but `convert(to:error:)` invokes it
// synchronously on the calling thread, so capturing the non-Sendable input
// buffer and the local `fed` flag is safe in practice. The annotation
// downgrades those AVFAudio-origin Sendable diagnostics, as the compiler advises.
@preconcurrency import AVFAudio

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

        // `nonisolated(unsafe)`: `convert` invokes the input block synchronously
        // on this thread, so `fed` is never touched concurrently despite the
        // block being typed `@Sendable`.
        nonisolated(unsafe) var fed = false
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
