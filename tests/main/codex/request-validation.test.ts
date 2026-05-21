import { describe, it, expect } from 'vitest'
import { validateAskRequest } from '../../../src/main/codex/request-validation'

describe('validateAskRequest', () => {
  it('returns a normalized request for valid input', () => {
    const result = validateAskRequest({ requestId: 'abc-123', question: '  hi  ' })
    expect(result).toEqual({ requestId: 'abc-123', question: 'hi' })
  })

  it('rejects a non-object value', () => {
    expect(() => validateAskRequest(null)).toThrow()
    expect(() => validateAskRequest('nope')).toThrow()
  })

  it('rejects a requestId containing path separators', () => {
    expect(() => validateAskRequest({ requestId: '../../etc/passwd', question: 'hi' })).toThrow()
  })

  it('rejects a requestId with slashes or dots', () => {
    expect(() => validateAskRequest({ requestId: 'a/b', question: 'hi' })).toThrow()
    expect(() => validateAskRequest({ requestId: 'a.b', question: 'hi' })).toThrow()
  })

  it('rejects an empty or overlong requestId', () => {
    expect(() => validateAskRequest({ requestId: '', question: 'hi' })).toThrow()
    expect(() => validateAskRequest({ requestId: 'x'.repeat(65), question: 'hi' })).toThrow()
  })

  it('rejects a non-string question', () => {
    expect(() => validateAskRequest({ requestId: 'abc', question: 123 })).toThrow()
  })

  it('rejects an empty or whitespace-only question', () => {
    expect(() => validateAskRequest({ requestId: 'abc', question: '   ' })).toThrow()
  })

  it('rejects an overlong question', () => {
    expect(() => validateAskRequest({ requestId: 'abc', question: 'x'.repeat(4001) })).toThrow()
  })

  it('accepts a standard crypto.randomUUID requestId', () => {
    const id = '2f1c8e4a-6b3d-4e2f-9a1b-7c5d8e6f0a2b'
    expect(validateAskRequest({ requestId: id, question: 'hi' }).requestId).toBe(id)
  })
})
