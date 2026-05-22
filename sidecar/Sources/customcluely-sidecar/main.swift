import Foundation

// Entry point for the Customcluely capture sidecar. It reads newline-delimited
// JSON commands from stdin, drives the capture units through CaptureCoordinator,
// and writes newline-delimited JSON events to stdout. The stdin read loop runs
// on a dedicated thread; the main run loop stays alive so async capture
// callbacks (ScreenCaptureKit, AVAudioEngine) keep firing.

// Both types are `@unchecked Sendable` with internal locking, so referencing
// them from the dedicated stdin read thread below is safe.
let transport = StdioTransport()
let coordinator = CaptureCoordinator(transport: transport)

let readThread = Thread {
    transport.readLoop { command in
        let result = coordinator.handle(command)
        if result.shouldExit {
            exit(0)
        }
    }
}
readThread.stackSize = 1 << 20
readThread.start()

// Keep the process alive for async capture callbacks until `shutdown` calls
// exit(0) from the read thread.
RunLoop.main.run()
