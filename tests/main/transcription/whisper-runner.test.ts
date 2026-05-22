import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runWhisper } from '../../../src/main/transcription/whisper-runner'

const FIXTURES = join(__dirname, '../../fixtures/whisper')

function scratchWav(): string {
  const dir = mkdtempSync(join(tmpdir(), 'whisper-runner-'))
  const wavPath = join(dir, 'window.wav')
  writeFileSync(wavPath, Buffer.alloc(64, 0))
  return wavPath
}

describe('runWhisper', () => {
  it('resolves with parsed transcript text on a successful run', async () => {
    const wavPath = scratchWav()
    const result = await runWhisper({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-whisper-ok.mjs')],
      modelPath: '/fake/model.bin',
      wavPath,
      timeoutMs: 5000
    })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('This is a mock transcription.')
  })

  it('resolves not-ok when whisper exits non-zero and keeps stderr out of error', async () => {
    const wavPath = scratchWav()
    const result = await runWhisper({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-whisper-fail.mjs')],
      modelPath: '/fake/model.bin',
      wavPath,
      timeoutMs: 5000
    })
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('/Users/secret/leaked/model.bin')
    expect(result.diagnostic).toContain('/Users/secret/leaked/model.bin')
  })

  it('resolves not-ok with a timeout message when whisper hangs', async () => {
    const wavPath = scratchWav()
    const result = await runWhisper({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-whisper-hang.mjs')],
      modelPath: '/fake/model.bin',
      wavPath,
      timeoutMs: 300
    })
    expect(result.ok).toBe(false)
    expect(result.error.toLowerCase()).toContain('timed out')
  })

  it('resolves not-ok when the command cannot be spawned', async () => {
    const result = await runWhisper({
      command: 'definitely-not-a-real-binary-xyz',
      prefixArgs: [],
      modelPath: '/fake/model.bin',
      wavPath: '/tmp/none.wav',
      timeoutMs: 2000
    })
    expect(result.ok).toBe(false)
    expect(result.error.length).toBeGreaterThan(0)
  })
})
