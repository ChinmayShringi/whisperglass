import { describe, it, expect } from 'vitest'
import { encodeWav } from '../../../src/main/transcription/wav-encoder'

describe('encodeWav', () => {
  it('prefixes a 44-byte header before the PCM payload', () => {
    const pcm = Buffer.alloc(32_000, 7)
    const wav = encodeWav(pcm, 16_000)
    expect(wav.length).toBe(44 + pcm.length)
  })

  it('writes the RIFF and WAVE magic markers', () => {
    const wav = encodeWav(Buffer.alloc(4, 1), 16_000)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.toString('ascii', 36, 40)).toBe('data')
  })

  it('encodes 16 kHz mono 16-bit PCM in the fmt chunk', () => {
    const wav = encodeWav(Buffer.alloc(8, 1), 16_000)
    expect(wav.readUInt16LE(20)).toBe(1) // audio format: PCM
    expect(wav.readUInt16LE(22)).toBe(1) // channels: mono
    expect(wav.readUInt32LE(24)).toBe(16_000) // sample rate
    expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
  })

  it('writes the correct data chunk size', () => {
    const pcm = Buffer.alloc(100, 3)
    const wav = encodeWav(pcm, 16_000)
    expect(wav.readUInt32LE(40)).toBe(100)
  })

  it('writes the correct RIFF chunk size', () => {
    const pcm = Buffer.alloc(100, 3)
    const wav = encodeWav(pcm, 16_000)
    expect(wav.readUInt32LE(4)).toBe(36 + 100)
  })

  it('writes the correct byte rate and block align', () => {
    const wav = encodeWav(Buffer.alloc(8, 1), 16_000)
    expect(wav.readUInt32LE(28)).toBe(16_000 * 2) // byte rate: rate * blockAlign
    expect(wav.readUInt16LE(32)).toBe(2) // block align: channels * bytesPerSample
  })
})
