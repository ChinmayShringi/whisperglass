// Mock `codex exec` that fails with NO structured JSONL error event: it only
// writes a sentinel line to stderr and exits non-zero. Exercises the runner's
// no-streamError path, proving raw stderr never substitutes into `error`.
process.stderr.write('/Users/secret/leaked/from/stderr\n')
process.exit(1)
