import Foundation
import SidecarCore

/// Thin glue around stdin and stdout. Reading is line-buffered: stdin data
/// arrives in arbitrary chunks, so partial lines are held until a newline
/// completes them. Writing is serialized through a lock so concurrent capture
/// callbacks (system audio, microphone) never interleave a half-written line.
///
/// `@unchecked Sendable`: `send(_:)` is guarded by `writeLock`, and the
/// mutable `inputBuffer` is only touched inside `readLoop` on its single
/// dedicated thread, so no data race is possible.
final class StdioTransport: @unchecked Sendable {
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
