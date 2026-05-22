// Mock Swift sidecar that crashes shortly after starting, to exercise the
// supervisor's restart-with-backoff path. It emits one status line so the
// supervisor sees it come up, then exits non-zero after a short delay.
process.stdout.write(
  `${JSON.stringify({ type: 'status', state: 'capturing', detail: 'up briefly' })}\n`
)
setTimeout(() => {
  process.exit(1)
}, 50)
