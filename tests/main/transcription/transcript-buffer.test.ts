import { describe, it, expect } from 'vitest'
import {
  createTranscriptBuffer,
  appendSegment,
  readSegments,
  type TranscriptBuffer
} from '../../../src/main/transcription/transcript-buffer'

describe('transcript-buffer', () => {
  it('starts empty', () => {
    const buffer = createTranscriptBuffer()
    expect(readSegments(buffer)).toEqual([])
  })

  it('appends a segment with a generated id, the speaker, and the text', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'hello world')
    const segments = readSegments(buffer)
    expect(segments).toHaveLength(1)
    expect(segments[0].speaker).toBe('you')
    expect(segments[0].text).toBe('hello world')
    expect(segments[0].id.length).toBeGreaterThan(0)
  })

  it('gives every appended segment a unique id', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'one')
    buffer = appendSegment(buffer, 'them', 'two')
    const segments = readSegments(buffer)
    expect(segments[0].id).not.toBe(segments[1].id)
  })

  it('preserves append order', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'first')
    buffer = appendSegment(buffer, 'you', 'second')
    buffer = appendSegment(buffer, 'them', 'third')
    expect(readSegments(buffer).map((s) => s.text)).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate the input buffer when appending', () => {
    const original = createTranscriptBuffer()
    appendSegment(original, 'you', 'ignored')
    expect(readSegments(original)).toEqual([])
  })

  it('returns a defensive copy from readSegments', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', 'safe')
    const first = readSegments(buffer)
    first.push({ id: 'x', speaker: 'them', text: 'injected' })
    expect(readSegments(buffer)).toHaveLength(1)
  })

  it('ignores an empty-text append and returns the same content', () => {
    let buffer: TranscriptBuffer = createTranscriptBuffer()
    buffer = appendSegment(buffer, 'you', '   ')
    expect(readSegments(buffer)).toEqual([])
  })
})
