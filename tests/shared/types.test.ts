import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'
import { WHISPER } from '../../src/main/config/constants'

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
    expect(IpcChannel.AudioFrame).toBe('transcription:audio-frame')
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
