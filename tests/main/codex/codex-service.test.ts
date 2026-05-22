import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { IpcChannel } from '../../../src/shared/types'

// Mock the runner so handleAsk never spawns a real subprocess. runCodexQuery
// returns a promise we control, letting a second handleAsk call arrive while
// the first is still in flight.
const runCodexQuery = vi.fn()
vi.mock('../../../src/main/codex/codex-runner', () => ({
  runCodexQuery: (...args: unknown[]) => runCodexQuery(...args)
}))

import { createCodexService } from '../../../src/main/codex/codex-service'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'codex-service-'))
}

interface Emitted {
  channel: string
  payload: unknown
}

describe('createCodexService.handleAsk', () => {
  beforeEach(() => {
    runCodexQuery.mockReset()
  })

  it('rejects a concurrent ask while one is already being processed', async () => {
    const emitted: Emitted[] = []
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })

    // First call: hold the runner pending so the second call overlaps it.
    let releaseRunner: (() => void) | undefined
    let runnerInvoked: () => void = () => {}
    const runnerStarted = new Promise<void>((resolve) => {
      runnerInvoked = resolve
    })
    runCodexQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          runnerInvoked()
          releaseRunner = () => resolve({ ok: true, text: 'done', error: '', diagnostic: '' })
        })
    )

    // Start the first ask and wait until its runner is actually in flight.
    const first = service.handleAsk({ requestId: 'req-1', question: 'first question' })
    await runnerStarted

    // The second ask overlaps the first: it must be rejected without spawning.
    await service.handleAsk({ requestId: 'req-2', question: 'second question' })

    const errors = emitted.filter((e) => e.channel === IpcChannel.AnswerError)
    expect(errors).toHaveLength(1)
    const payload = errors[0].payload as { requestId: string; message: string }
    expect(payload.requestId).toBe('req-2')
    expect(payload.message.toLowerCase()).toContain('already being processed')

    // The runner ran exactly once: the second call never reached it.
    expect(runCodexQuery).toHaveBeenCalledTimes(1)

    releaseRunner?.()
    await first
  })

  it('allows a new ask after the previous one finishes', async () => {
    const emitted: Emitted[] = []
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })
    runCodexQuery.mockResolvedValue({ ok: true, text: 'done', error: '', diagnostic: '' })

    await service.handleAsk({ requestId: 'req-1', question: 'first question' })
    await service.handleAsk({ requestId: 'req-2', question: 'second question' })

    expect(runCodexQuery).toHaveBeenCalledTimes(2)
    expect(emitted.filter((e) => e.channel === IpcChannel.AnswerError)).toHaveLength(0)
  })

  it('never leaks the runner diagnostic into the emitted AnswerError payload', async () => {
    const emitted: Emitted[] = []
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })
    runCodexQuery.mockResolvedValue({
      ok: false,
      text: '',
      error: 'safe message',
      diagnostic: '/Users/secret/leaked'
    })

    await service.handleAsk({ requestId: 'req-1', question: 'a question' })

    const errors = emitted.filter((e) => e.channel === IpcChannel.AnswerError)
    expect(errors).toHaveLength(1)
    const payload = errors[0].payload as Record<string, unknown>
    // The payload carries only the request id and the sanitized message.
    expect(Object.keys(payload).sort()).toEqual(['message', 'requestId'])
    expect(payload.message).toBe('safe message')
    expect(payload.requestId).toBe('req-1')
    // The internal-only diagnostic must appear nowhere in the emitted payload.
    expect(JSON.stringify(payload)).not.toContain('/Users/secret/leaked')
  })
})

describe('createCodexService.handleContextAsk', () => {
  beforeEach(() => {
    runCodexQuery.mockReset()
  })

  it('runs a query that carries the transcript context and emits the answer', async () => {
    const emitted: Emitted[] = []
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ctx answer', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })
    await service.handleContextAsk({
      requestId: 'ctx-1',
      question: 'what next',
      segments: [{ id: 's1', speaker: 'them', text: 'we must hit the deadline' }],
      screenshot: false,
      extraArgs: []
    })
    const done = emitted.filter((e) => e.channel === IpcChannel.AnswerDone)
    expect(done).toHaveLength(1)
    expect((done[0].payload as { text: string }).text).toBe('ctx answer')
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    const prompt = passedArgs.at(-1) as string
    expect(prompt).toContain('we must hit the deadline')
  })

  it('passes extraArgs through to the codex args', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    await service.handleContextAsk({
      requestId: 'ctx-2',
      question: 'is that true',
      segments: [],
      screenshot: false,
      extraArgs: ['--search']
    })
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    expect(passedArgs).toContain('--search')
  })

  it('attaches the screenshot path with -i when one is provided', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    await service.handleContextAsk(
      {
        requestId: 'ctx-3',
        question: 'what is on screen',
        segments: [],
        screenshot: true,
        extraArgs: []
      },
      '/tmp/scratch/screenshots/shot-xyz.png'
    )
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    expect(passedArgs).toEqual(
      expect.arrayContaining(['-i', '/tmp/scratch/screenshots/shot-xyz.png'])
    )
  })

  it('deletes the screenshot file after the query completes', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    // A real temporary PNG that the runner's finally block must remove.
    const imagePath = join(tmpdir(), `codex-shot-${randomUUID()}.png`)
    await writeFile(imagePath, Buffer.from('png-bytes'))
    await service.handleContextAsk(
      {
        requestId: 'ctx-shot-cleanup',
        question: 'what is on screen',
        segments: [],
        screenshot: true,
        extraArgs: []
      },
      imagePath
    )
    // The file existed during the query and is gone once it finishes.
    await expect(access(imagePath)).rejects.toThrow()
  })

  it('does not attach an image when screenshot is true but no path is given', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    await service.handleContextAsk({
      requestId: 'ctx-4',
      question: 'q',
      segments: [],
      screenshot: true,
      extraArgs: []
    })
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    expect(passedArgs).not.toContain('-i')
  })

  it('rejects a concurrent context-ask while a query is in flight', async () => {
    const emitted: Emitted[] = []
    let release: (() => void) | undefined
    let started: () => void = () => {}
    const startedP = new Promise<void>((resolve) => {
      started = resolve
    })
    runCodexQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          started()
          release = () => resolve({ ok: true, text: 'first', error: '', diagnostic: '' })
        })
    )
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })
    const first = service.handleContextAsk({
      requestId: 'ctx-5',
      question: 'first',
      segments: [],
      screenshot: false,
      extraArgs: []
    })
    await startedP
    await service.handleContextAsk({
      requestId: 'ctx-6',
      question: 'second',
      segments: [],
      screenshot: false,
      extraArgs: []
    })
    const errors = emitted.filter((e) => e.channel === IpcChannel.AnswerError)
    expect(errors).toHaveLength(1)
    release?.()
    await first
  })
})
