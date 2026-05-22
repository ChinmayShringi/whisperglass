// Mock `whisper-cli` failure: writes a leaky absolute path to stderr and
// exits 1, so the runner test can confirm stderr never reaches user-facing
// errors.
process.stderr.write('whisper: failed to load model /Users/secret/leaked/model.bin\n')
process.exit(1)
