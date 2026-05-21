// Mock `codex exec` failure: emits an error event and exits non-zero.
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
emit({ type: 'thread.started', thread_id: 't-mock' })
emit({ type: 'turn.failed', error: { message: 'mock codex failure' } })
process.exit(1)
