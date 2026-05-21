import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { splitLines } from './line-splitter'
import { parseCodexLine } from './event-parser'
import { createAccumulator, accumulate, type AccumulatorState } from './answer-accumulator'

export interface RunCodexInput {
  command: string
  args: string[]
  outputFile: string
  timeoutMs: number
}

export interface RunCodexHandlers {
  onChunk: (delta: string) => void
}

export interface RunCodexResult {
  ok: boolean
  text: string
  error: string
}

export function runCodexQuery(
  input: RunCodexInput,
  handlers: RunCodexHandlers,
): Promise<RunCodexResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let buffer = ''
    let acc: AccumulatorState = createAccumulator()
    let streamError = ''
    let stderr = ''
    let settled = false

    const finish = (result: RunCodexResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, text: '', error: `Codex timed out after ${input.timeoutMs} ms.` })
    }, input.timeoutMs)

    // Register the error handler before touching the stdio streams. When spawn
    // fails (for example the binary is missing), child.stdout and child.stderr
    // can be null and the failure is delivered through this event.
    child.on('error', (err: Error) => {
      finish({ ok: false, text: '', error: `Failed to start Codex: ${err.message}` })
    })

    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        const split = splitLines(buffer, chunk)
        buffer = split.rest
        for (const line of split.lines) {
          const event = parseCodexLine(line)
          if (event.kind === 'agent-text') {
            const next = accumulate(acc, event.text)
            acc = next.state
            if (next.delta.length > 0) handlers.onChunk(next.delta)
          } else if (event.kind === 'turn-failed' || event.kind === 'error') {
            streamError = event.message
          }
        }
      })
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }

    child.on('close', (code: number | null) => {
      if (code === 0) {
        readFile(input.outputFile, 'utf8')
          .then((text) => finish({ ok: true, text: text.trim(), error: '' }))
          .catch(() => finish({ ok: true, text: acc.full.trim(), error: '' }))
        return
      }
      const detail = streamError || stderr.trim() || `Codex exited with code ${code}.`
      finish({ ok: false, text: '', error: detail })
    })
  })
}
