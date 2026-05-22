import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWhisperJson } from '../../../src/main/transcription/whisper-json-parser'

const FIXTURE = join(__dirname, '../../fixtures/whisper/sample-output.json')

describe('parseWhisperJson', () => {
  it('returns the joined trimmed text of every transcription segment', () => {
    const raw = readFileSync(FIXTURE, 'utf8')
    const result = parseWhisperJson(raw)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('Hello and welcome to the meeting. Let us get started.')
  })

  it('returns ok with empty text when the transcription array is empty', () => {
    const result = parseWhisperJson('{"transcription": []}')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('')
  })

  it('returns not-ok for invalid JSON', () => {
    const result = parseWhisperJson('not json')
    expect(result.ok).toBe(false)
    expect(result.text).toBe('')
  })

  it('returns not-ok when there is no transcription array', () => {
    const result = parseWhisperJson('{"model": {}}')
    expect(result.ok).toBe(false)
  })

  it('skips segments whose text is not a string', () => {
    const raw = '{"transcription": [{"text": "kept"}, {"text": 42}, {"text": " also kept"}]}'
    const result = parseWhisperJson(raw)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('kept also kept')
  })
})
