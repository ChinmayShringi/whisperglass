import { describe, it, expect } from 'vitest'
import { resolveWhisperPaths } from '../../../src/main/transcription/resolve-whisper-paths'

describe('resolveWhisperPaths', () => {
  it('builds the binary and model paths under the resources root', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: () => true
    })
    expect(result.binaryPath).toBe('/app/resources/whisper/whisper-cli')
    expect(result.modelPath).toBe('/app/resources/whisper/ggml-base.en.bin')
  })

  it('reports the binary present when the file exists', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: (p) => p === '/app/resources/whisper/whisper-cli'
    })
    expect(result.binaryPresent).toBe(true)
    expect(result.modelPresent).toBe(false)
  })

  it('reports the model present when the file exists', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: (p) => p === '/app/resources/whisper/ggml-base.en.bin'
    })
    expect(result.binaryPresent).toBe(false)
    expect(result.modelPresent).toBe(true)
  })

  it('reports both missing when nothing exists', () => {
    const result = resolveWhisperPaths({
      resourcesRoot: '/app/resources',
      fileExists: () => false
    })
    expect(result.binaryPresent).toBe(false)
    expect(result.modelPresent).toBe(false)
  })
})
