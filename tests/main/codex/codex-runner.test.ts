import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runCodexQuery } from '../../../src/main/codex/codex-runner'

const FIXTURES = join(__dirname, '../../fixtures/codex')

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'codex-runner-'))
}

describe('runCodexQuery', () => {
  it('streams chunks and resolves with the output-file text on success', async () => {
    const dir = scratch()
    const outputFile = join(dir, 'answer.txt')
    const chunks: string[] = []
    const result = await runCodexQuery(
      {
        command: 'node',
        args: [join(FIXTURES, 'mock-codex-ok.mjs'), '-o', outputFile],
        outputFile,
        timeoutMs: 5000,
      },
      { onChunk: (delta) => chunks.push(delta) },
    )
    expect(result.ok).toBe(true)
    expect(result.text).toBe('A closure is a function bundled with its surrounding state.')
    expect(chunks.join('')).toBe('A closure is a function bundled with its surrounding state.')
  })

  it('resolves not-ok with the failure message when Codex exits non-zero', async () => {
    const dir = scratch()
    const outputFile = join(dir, 'answer.txt')
    const result = await runCodexQuery(
      {
        command: 'node',
        args: [join(FIXTURES, 'mock-codex-fail.mjs'), '-o', outputFile],
        outputFile,
        timeoutMs: 5000,
      },
      { onChunk: () => {} },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('mock codex failure')
  })

  it('resolves not-ok with a timeout message when the process hangs', async () => {
    const dir = scratch()
    const outputFile = join(dir, 'answer.txt')
    const result = await runCodexQuery(
      {
        command: 'node',
        args: [join(FIXTURES, 'mock-codex-hang.mjs'), '-o', outputFile],
        outputFile,
        timeoutMs: 300,
      },
      { onChunk: () => {} },
    )
    expect(result.ok).toBe(false)
    expect(result.error.toLowerCase()).toContain('timed out')
  })

  it('resolves not-ok when the command cannot be spawned', async () => {
    const result = await runCodexQuery(
      {
        command: 'definitely-not-a-real-binary-xyz',
        args: [],
        outputFile: '/tmp/none.txt',
        timeoutMs: 2000,
      },
      { onChunk: () => {} },
    )
    expect(result.ok).toBe(false)
    expect(result.error.length).toBeGreaterThan(0)
  })
})
