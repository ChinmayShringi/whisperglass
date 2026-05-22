import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { parseWhisperJson } from './whisper-json-parser'

export interface RunWhisperInput {
  /** The whisper-cli binary, or `node` in tests. */
  command: string
  /** Args inserted before whisper's own flags (the mock script path in tests). */
  prefixArgs: string[]
  /** Absolute path to the ggml model file. */
  modelPath: string
  /** Absolute path to the 16 kHz mono WAV window to transcribe. */
  wavPath: string
  /** Hard timeout for the subprocess. */
  timeoutMs: number
}

export interface RunWhisperResult {
  ok: boolean
  /** Parsed transcript text for the window; empty on failure. */
  text: string
  /**
   * Internal-only detail (raw stderr). NEVER emit to the renderer: it can
   * contain absolute filesystem paths. Always present; empty when nothing.
   */
  diagnostic: string
  /** Generic user-facing error message; never contains raw stderr. */
  error: string
}

// Spawns `whisper-cli` on one WAV window and returns its transcript. whisper
// writes its result to `<wavPath>.json` because of the --output-json flag;
// the runner reads and parses that file, then deletes it. Mirrors the proven
// codex-runner.ts shape: a single Promise, a timeout, an error handler bound
// before the stdio streams, and raw stderr kept out of the user-facing error.
export function runWhisper(input: RunWhisperInput): Promise<RunWhisperResult> {
  return new Promise((resolve) => {
    const jsonPath = `${input.wavPath}.json`
    const args = [
      ...input.prefixArgs,
      '-m',
      input.modelPath,
      '-f',
      input.wavPath,
      '-l',
      'en',
      '-oj',
      '-nt',
      '-np'
    ]
    const child = spawn(input.command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    let settled = false

    const finish = (result: RunWhisperResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void rm(jsonPath, { force: true }).catch(() => {})
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        ok: false,
        text: '',
        diagnostic: '',
        error: `Transcription timed out after ${input.timeoutMs} ms.`
      })
    }, input.timeoutMs)

    // Bind the error handler before touching stdio: on a spawn failure the
    // streams can be null and the failure arrives through this event.
    child.on('error', (err: Error) => {
      finish({
        ok: false,
        text: '',
        diagnostic: '',
        error: `Failed to start whisper-cli: ${err.message}`
      })
    })

    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        finish({
          ok: false,
          text: '',
          diagnostic: stderr.trim(),
          error: `Transcription failed (exit code ${code}).`
        })
        return
      }
      readFile(jsonPath, 'utf8')
        .then((raw) => {
          const parsed = parseWhisperJson(raw)
          if (!parsed.ok) {
            finish({
              ok: false,
              text: '',
              diagnostic: 'whisper produced unreadable JSON output.',
              error: 'Transcription produced no readable output.'
            })
            return
          }
          finish({ ok: true, text: parsed.text, diagnostic: '', error: '' })
        })
        .catch(() => {
          finish({
            ok: false,
            text: '',
            diagnostic: 'whisper JSON output file was missing.',
            error: 'Transcription produced no output.'
          })
        })
    })
  })
}
