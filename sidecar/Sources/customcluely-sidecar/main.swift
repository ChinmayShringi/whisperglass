// Phase 4 Task 1 placeholder entry point. The full stdin/stdout loop and the
// capture units are added in later tasks (Task 6 onward). This minimal body
// lets the executable target compile so `swift test` can build the package.
import Foundation

FileHandle.standardError.write(Data("customcluely-sidecar: not yet wired\n".utf8))
exit(0)
