import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'

describe('IpcChannel', () => {
  it('keeps the Phase 1 overlay channels', () => {
    expect(IpcChannel.ToggleInvisibility).toBe('overlay:toggle-invisibility')
    expect(IpcChannel.OverlayState).toBe('overlay:state')
  })

  it('adds the Codex channels with namespaced values', () => {
    expect(IpcChannel.AskQuestion).toBe('codex:ask')
    expect(IpcChannel.AnswerChunk).toBe('codex:answer-chunk')
    expect(IpcChannel.AnswerDone).toBe('codex:answer-done')
    expect(IpcChannel.AnswerError).toBe('codex:answer-error')
    expect(IpcChannel.CodexStatus).toBe('codex:status')
  })

  it('uses a unique string per channel', () => {
    const values = Object.values(IpcChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})
