import { describe, it, expect, vi } from 'vitest'
import { downloadModel } from '../../../src/main/transcription/model-downloader'

function fakeStream(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  }
}

describe('downloadModel', () => {
  it('returns already-present without fetching when the model exists at full size', async () => {
    const fetchHttp = vi.fn()
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 100,
      fileExists: () => true,
      fileSize: () => 100,
      fetchHttp,
      writeStream: vi.fn(),
      onProgress: vi.fn()
    })
    expect(result.ok).toBe(true)
    expect(result.alreadyPresent).toBe(true)
    expect(fetchHttp).not.toHaveBeenCalled()
  })

  it('downloads when the model is missing and reports progress', async () => {
    const progress: number[] = []
    const writeStream = vi.fn(async () => {})
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 6,
      fileExists: () => false,
      fileSize: () => 0,
      fetchHttp: async () => ({ totalBytes: 6, body: fakeStream([Buffer.from('abc'), Buffer.from('def')]) }),
      writeStream,
      onProgress: (fraction) => progress.push(fraction)
    })
    expect(result.ok).toBe(true)
    expect(result.alreadyPresent).toBe(false)
    expect(writeStream).toHaveBeenCalledOnce()
    expect(progress[progress.length - 1]).toBe(1)
  })

  it('re-downloads when an existing file is the wrong size', async () => {
    const fetchHttp = vi.fn(async () => ({
      totalBytes: 6,
      body: fakeStream([Buffer.from('abcdef')])
    }))
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 6,
      fileExists: () => true,
      fileSize: () => 3,
      fetchHttp,
      writeStream: vi.fn(async () => {}),
      onProgress: vi.fn()
    })
    expect(result.ok).toBe(true)
    expect(fetchHttp).toHaveBeenCalledOnce()
  })

  it('returns not-ok with a message when the fetch throws', async () => {
    const result = await downloadModel({
      modelPath: '/r/whisper/ggml-base.en.bin',
      url: 'https://example.test/model.bin',
      expectedBytes: 6,
      fileExists: () => false,
      fileSize: () => 0,
      fetchHttp: async () => {
        throw new Error('network down')
      },
      writeStream: vi.fn(),
      onProgress: vi.fn()
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network down')
  })
})
