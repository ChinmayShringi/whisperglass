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
