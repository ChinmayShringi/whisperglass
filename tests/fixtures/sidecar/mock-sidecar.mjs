// Mock Swift sidecar for the supervisor test. It speaks the newline-delimited
// JSON protocol over stdio: on `start` it emits a `status` capturing event,
// one `audio` frame, and a `permission` event; on `screenshot` it emits a
// `screenshot` event; on `shutdown` it exits 0. Malformed input is ignored.
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    handleLine(line)
    index = buffer.indexOf('\n')
  }
})

function send(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`)
}

function handleLine(line) {
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  if (!command || typeof command.type !== 'string') return
  if (command.type === 'start') {
    send({ type: 'status', state: 'capturing', detail: 'Capture started.' })
    send({ type: 'permission', kind: 'mic', granted: true })
    send({ type: 'audio', source: 'mic', seq: 1, sampleRate: 16000, pcm: 'QUJD' })
  } else if (command.type === 'screenshot') {
    send({ type: 'screenshot', format: 'png', data: 'aW1n' })
  } else if (command.type === 'shutdown') {
    process.exit(0)
  }
}
