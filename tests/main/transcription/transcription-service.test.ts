import { describe, it, expect, vi } from 'vitest'
import { createTranscriptionService } from '../../../src/main/transcription/transcription-service'
import { IpcChannel } from '../../../src/shared/types'

// A 1-second mono 16 kHz 16-bit PCM frame is 32000 bytes. An 8 s window is
// 256000 bytes, so 8 frames produce exactly one window.
function frameBase64(): string {
  return Buffer.alloc(32_000, 1).toString('base64')
}

function makeDeps(runWhisper: ReturnType<typeof vi.fn>) {
  return {
    emit: vi.fn(),
    runWhisper,
    modelPath: '/fake/model.bin'
  }
}

describe('createTranscriptionService', () => {
  it('does not run whisper before a full window is buffered', async () => {
    const runWhisper = vi.fn()
    const service = createTranscriptionService(makeDeps(runWhisper))
    await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    expect(runWhisper).not.toHaveBeenCalled()
  })

  it('runs whisper once a full 8-second window is buffered for one source', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const service = createTranscriptionService(makeDeps(runWhisper))
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('appends a mic-source window with the "you" speaker', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    const payload = updateCall![1] as { segments: { speaker: string; text: string }[] }
    expect(payload.segments[0].speaker).toBe('you')
  })

  it('appends a system-source window with the "them" speaker', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'system audio line', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'system')
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    const payload = updateCall![1] as { segments: { speaker: string; text: string }[] }
    expect(payload.segments[0].speaker).toBe('them')
  })

  it('keeps independent rolling windows per source', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'a line', diagnostic: '', error: '' }))
    const service = createTranscriptionService(makeDeps(runWhisper))
    // 7 mic frames and 7 system frames: neither source reaches a full window.
    for (let i = 0; i < 7; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'system')
    }
    expect(runWhisper).not.toHaveBeenCalled()
    // The 8th mic frame completes the mic window only.
    await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('de-duplicates the overlap within a single source', async () => {
    const runWhisper = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: 'the meeting starts now', diagnostic: '', error: '' })
      .mockResolvedValueOnce({ ok: true, text: 'starts now and runs long', diagnostic: '', error: '' })
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 16; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    const updates = deps.emit.mock.calls.filter((c) => c[0] === IpcChannel.TranscriptUpdate)
    const last = updates[updates.length - 1][1] as { segments: { text: string }[] }
    expect(last.segments.map((s) => s.text)).toEqual(['the meeting starts now', 'and runs long'])
  })

  it('does not append a segment when whisper fails for a window', async () => {
    const runWhisper = vi.fn(async () => ({
      ok: false,
      text: '',
      diagnostic: 'leaky path',
      error: 'Transcription failed.'
    }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    const updates = deps.emit.mock.calls.filter((c) => c[0] === IpcChannel.TranscriptUpdate)
    expect(updates).toHaveLength(0)
  })

  it('reset clears the buffer and both per-source accumulators', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'hello world', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    service.reset()
    deps.emit.mockClear()
    for (let i = 0; i < 7; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() }, 'mic')
    }
    expect(runWhisper).toHaveBeenCalledOnce()
  })

  it('defaults the source to mic when none is given', async () => {
    const runWhisper = vi.fn(async () => ({ ok: true, text: 'defaulted', diagnostic: '', error: '' }))
    const deps = makeDeps(runWhisper)
    const service = createTranscriptionService(deps)
    for (let i = 0; i < 8; i += 1) {
      await service.handleAudioFrame({ pcmBase64: frameBase64() })
    }
    const updateCall = deps.emit.mock.calls.find((c) => c[0] === IpcChannel.TranscriptUpdate)
    const payload = updateCall![1] as { segments: { speaker: string }[] }
    expect(payload.segments[0].speaker).toBe('you')
  })
})
