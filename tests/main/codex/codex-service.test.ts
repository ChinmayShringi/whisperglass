import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
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
