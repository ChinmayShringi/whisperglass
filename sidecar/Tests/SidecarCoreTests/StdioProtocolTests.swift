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
