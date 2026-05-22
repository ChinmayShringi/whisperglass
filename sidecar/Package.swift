// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "customcluely-sidecar",
    platforms: [
        // ScreenCaptureKit audio capture and SCScreenshotManager both require
        // macOS 14. The whole app is macOS-only, so this is the floor.
        .macOS(.v14)
    ],
    targets: [
        // Pure, testable logic: the stdio protocol codec and message types.
        // Kept separate from the executable target so XCTest can import it
        // without pulling in `@main`.
        .target(name: "SidecarCore"),
        // The capture executable. Capture units live here; they need real
        // audio and screen hardware and are verified by the manual checklist.
        .executableTarget(
            name: "customcluely-sidecar",
            dependencies: ["SidecarCore"]
        ),
        .testTarget(
            name: "SidecarCoreTests",
            dependencies: ["SidecarCore"]
        )
    ]
)
