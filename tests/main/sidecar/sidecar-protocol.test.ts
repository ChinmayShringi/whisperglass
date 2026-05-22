import { describe, it, expect } from 'vitest'
import { parseSidecarLine, encodeSidecarCommand } from '../../../src/main/sidecar/sidecar-protocol'

describe('parseSidecarLine', () => {
  it('parses an audio event', () => {
    const line = JSON.stringify({
      type: 'audio',
      source: 'system',
      seq: 3,
      sampleRate: 16000,
      pcm: 'QUJD'
    })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'audio',
      source: 'system',
      seq: 3,
      sampleRate: 16000,
      pcm: 'QUJD'
    })
  })

  it('parses a mic-source audio event', () => {
    const line = JSON.stringify({
      type: 'audio',
      source: 'mic',
      seq: 1,
      sampleRate: 16000,
      pcm: 'AAAA'
    })
    const event = parseSidecarLine(line)
    expect(event.kind).toBe('audio')
    if (event.kind === 'audio') expect(event.source).toBe('mic')
  })

  it('parses a screenshot event', () => {
    const line = JSON.stringify({ type: 'screenshot', format: 'png', data: 'aW1n' })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'screenshot',
      format: 'png',
      dataBase64: 'aW1n'
    })
  })

  it('parses a status event', () => {
    const line = JSON.stringify({ type: 'status', state: 'capturing', detail: 'ok' })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'status',
      state: 'capturing',
      detail: 'ok'
    })
  })

  it('parses a permission event', () => {
    const line = JSON.stringify({ type: 'permission', kind: 'screen', granted: false })
    expect(parseSidecarLine(line)).toEqual({
      kind: 'permission',
      permissionKind: 'screen',
      granted: false
    })
  })

  it('returns ignored for an empty line', () => {
    expect(parseSidecarLine('')).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for invalid JSON', () => {
    expect(parseSidecarLine('not json')).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for JSON missing a type', () => {
    expect(parseSidecarLine(JSON.stringify({ source: 'system' }))).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for an unknown event type', () => {
    expect(parseSidecarLine(JSON.stringify({ type: 'explode' }))).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for an audio event with a non-string pcm', () => {
    const line = JSON.stringify({
      type: 'audio',
      source: 'system',
      seq: 1,
      sampleRate: 16000,
      pcm: 42
    })
    expect(parseSidecarLine(line)).toEqual({ kind: 'ignored' })
  })

  it('returns ignored for an audio event with an unknown source', () => {
    const line = JSON.stringify({
      type: 'audio',
      source: 'radio',
      seq: 1,
      sampleRate: 16000,
      pcm: 'AA'
    })
    expect(parseSidecarLine(line)).toEqual({ kind: 'ignored' })
  })

  it('never throws on arbitrary input', () => {
    expect(() => parseSidecarLine('{{{')).not.toThrow()
    expect(() => parseSidecarLine('null')).not.toThrow()
    expect(() => parseSidecarLine('[]')).not.toThrow()
  })
})

describe('encodeSidecarCommand', () => {
  it('encodes a start command as one newline-terminated JSON line', () => {
    const line = encodeSidecarCommand({
      type: 'start',
      capture: ['systemAudio', 'mic'],
      appBundleId: 'com.whisperglass.app'
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.indexOf('\n')).toBe(line.length - 1)
    expect(JSON.parse(line)).toEqual({
      type: 'start',
      capture: ['systemAudio', 'mic'],
      appBundleId: 'com.whisperglass.app'
    })
  })

  it('encodes a screenshot command', () => {
    expect(encodeSidecarCommand({ type: 'screenshot' })).toBe('{"type":"screenshot"}\n')
  })

  it('encodes a stop command', () => {
    expect(encodeSidecarCommand({ type: 'stop' })).toBe('{"type":"stop"}\n')
  })

  it('encodes a shutdown command', () => {
    expect(encodeSidecarCommand({ type: 'shutdown' })).toBe('{"type":"shutdown"}\n')
  })
})
