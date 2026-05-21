import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexLine } from '../../../src/main/codex/event-parser'

describe('parseCodexLine', () => {
  it('ignores blank lines', () => {
    expect(parseCodexLine('   ')).toEqual({ kind: 'ignored' })
  })

  it('ignores non-JSON lines', () => {
    expect(parseCodexLine('not json')).toEqual({ kind: 'ignored' })
  })

  it('ignores lifecycle events with no answer text', () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t-1"}')).toEqual({ kind: 'ignored' })
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual({ kind: 'ignored' })
  })

  it('extracts agent-message text from item events', () => {
    const line = '{"type":"item.updated","item":{"item_type":"agent_message","text":"hello"}}'
    expect(parseCodexLine(line)).toEqual({ kind: 'agent-text', text: 'hello' })
  })

  it('extracts agent text when content is an array of parts', () => {
    const line =
      '{"type":"item.completed","item":{"item_type":"agent_message","content":[{"text":"a "},{"text":"b"}]}}'
    expect(parseCodexLine(line)).toEqual({ kind: 'agent-text', text: 'a b' })
  })

  it('maps turn.completed to turn-complete', () => {
    expect(parseCodexLine('{"type":"turn.completed"}')).toEqual({ kind: 'turn-complete' })
  })

  it('maps turn.failed to a turn-failed event with a message', () => {
    const line = '{"type":"turn.failed","error":{"message":"rate limited"}}'
    expect(parseCodexLine(line)).toEqual({ kind: 'turn-failed', message: 'rate limited' })
  })

  it('maps error events to an error event with a message', () => {
    const line = '{"type":"error","message":"not authenticated"}'
    expect(parseCodexLine(line)).toEqual({ kind: 'error', message: 'not authenticated' })
  })

  it('parses every line of the sample fixture without throwing', () => {
    const fixture = readFileSync(join(__dirname, '../../fixtures/codex/sample-stream.jsonl'), 'utf8')
    const events = fixture.trim().split('\n').map(parseCodexLine)
    expect(events.some((e) => e.kind === 'agent-text')).toBe(true)
    expect(events.some((e) => e.kind === 'turn-complete')).toBe(true)
  })
})
