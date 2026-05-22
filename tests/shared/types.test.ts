import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'
import { WHISPER, SIDECAR, CONTEXT, INSIGHTS } from '../../src/main/config/constants'

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

describe('Phase 3 IpcChannel entries', () => {
  it('defines the transcription channels', () => {
    expect(IpcChannel.StartTranscription).toBe('transcription:start')
    expect(IpcChannel.StopTranscription).toBe('transcription:stop')
    expect(IpcChannel.TranscriptUpdate).toBe('transcription:update')
    expect(IpcChannel.TranscriptionStatus).toBe('transcription:status')
  })
})

describe('WHISPER constants', () => {
  it('pins the model file, sample rate, and window timing', () => {
    expect(WHISPER.modelFileName).toBe('ggml-base.en.bin')
    expect(WHISPER.binaryName).toBe('whisper-cli')
    expect(WHISPER.sampleRate).toBe(16000)
    expect(WHISPER.windowSeconds).toBe(8)
    expect(WHISPER.overlapSeconds).toBe(2)
    expect(WHISPER.frameSeconds).toBe(1)
    expect(WHISPER.modelByteSize).toBe(147964211)
    expect(WHISPER.modelUrl).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
    )
  })
})

describe('Phase 4 IpcChannel entries', () => {
  it('defines the sidecar status and screenshot channels', () => {
    expect(IpcChannel.SidecarStatus).toBe('sidecar:status')
    expect(IpcChannel.Screenshot).toBe('sidecar:screenshot')
  })

  it('no longer defines the renderer AudioFrame channel', () => {
    expect((IpcChannel as Record<string, string>).AudioFrame).toBeUndefined()
  })
})

describe('SIDECAR constants', () => {
  it('pins the binary name, app bundle id, and supervisor timings', () => {
    expect(SIDECAR.binaryName).toBe('customcluely-sidecar')
    expect(SIDECAR.appBundleId).toBe('com.customcluely.app')
    expect(SIDECAR.stableUptimeMs).toBe(10_000)
    expect(SIDECAR.maxBackoffMs).toBe(8_000)
    expect(SIDECAR.baseBackoffMs).toBe(1_000)
  })
})

describe('Phase 5 IpcChannel entries', () => {
  it('defines the context-ask and screenshot-request channels', () => {
    expect(IpcChannel.AskContextQuestion).toBe('codex:ask-context')
    expect(IpcChannel.RequestScreenshot).toBe('sidecar:request-screenshot')
  })
})

describe('CONTEXT constants', () => {
  it('pins the verbatim recent-segment count and the older-segment char budget', () => {
    expect(CONTEXT.recentSegments).toBe(12)
    expect(CONTEXT.olderCharBudget).toBe(1200)
    expect(CONTEXT.olderMarker).toBe('[earlier in the meeting]')
  })
})

describe('INSIGHTS constants', () => {
  it('pins the max surfaced insight count and a non-empty keyword list', () => {
    expect(INSIGHTS.maxSurfaced).toBe(5)
    expect(Array.isArray(INSIGHTS.keywords)).toBe(true)
    expect(INSIGHTS.keywords).toContain('deadline')
    expect(INSIGHTS.keywords).toContain('action item')
    expect(INSIGHTS.keywords.length).toBeGreaterThanOrEqual(8)
  })
})
