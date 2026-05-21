import { describe, it, expect } from 'vitest'
import { buildCodexArgs } from '../../../src/main/codex/codex-args'

const base = { prompt: 'hi', outputFile: '/tmp/out.txt', workdir: '/tmp/scratch' }

describe('buildCodexArgs', () => {
  it('starts with the exec subcommand and JSON streaming', () => {
    const args = buildCodexArgs(base)
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
  })

  it('runs ephemeral, outside a git repo, read-only', () => {
    const args = buildCodexArgs(base)
    expect(args).toContain('--ephemeral')
    expect(args).toContain('--skip-git-repo-check')
    expect(args).toEqual(expect.arrayContaining(['-s', 'read-only']))
  })

  it('passes the working directory and output file', () => {
    const args = buildCodexArgs(base)
    expect(args).toEqual(expect.arrayContaining(['-C', '/tmp/scratch']))
    expect(args).toEqual(expect.arrayContaining(['-o', '/tmp/out.txt']))
  })

  it('sets low reasoning effort via a config override', () => {
    const args = buildCodexArgs(base)
    const idx = args.indexOf('-c')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe('model_reasoning_effort="low"')
  })

  it('puts the prompt last', () => {
    expect(buildCodexArgs(base).at(-1)).toBe('hi')
  })

  it('omits the model flag unless a model is given', () => {
    expect(buildCodexArgs(base)).not.toContain('-m')
    expect(buildCodexArgs({ ...base, model: 'gpt-5' })).toEqual(
      expect.arrayContaining(['-m', 'gpt-5']),
    )
  })
})
