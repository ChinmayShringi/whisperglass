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
