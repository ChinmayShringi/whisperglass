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
    /// `completion` is `@Sendable` because AVCaptureDevice calls it back on an
    /// arbitrary internal queue.
    static func requestMicAccess(completion: @escaping @Sendable (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio, completionHandler: completion)
    }
}
