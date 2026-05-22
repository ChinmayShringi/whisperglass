// Mock `whisper-cli` that never exits, to exercise the runner timeout.
setInterval(() => {}, 1000)
