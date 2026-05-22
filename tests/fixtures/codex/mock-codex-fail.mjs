// Mock `codex exec` failure: emits an error event and exits non-zero.
// Also writes a recognizable sentinel line to stderr so tests can prove the
// raw stderr lands in `diagnostic` but never in the user-facing `error`.
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
emit({ type: 'thread.started', thread_id: 't-mock' })
emit({ type: 'turn.failed', error: { message: 'mock codex failure' } })
process.stderr.write('/Users/secret/private/path leaked\n')
process.exit(1)
