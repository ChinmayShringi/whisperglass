// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '../../../src/renderer/src/hooks/useSession'

beforeEach(() => {
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion: vi.fn(),
    askContextQuestion: vi.fn(),
    requestScreenshot: vi.fn(),
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    onTranscriptUpdate: vi.fn(() => () => {}),
    onTranscriptionStatus: vi.fn(() => () => {}),
    onSidecarStatus: vi.fn(() => () => {}),
    onScreenshot: vi.fn(() => () => {})
  }
})

describe('useSession', () => {
  it('starts inactive', () => {
    const { result } = renderHook(() => useSession())
    expect(result.current.active).toBe(false)
  })

  it('toggle starts a session and starts transcription capture', () => {
    const { result } = renderHook(() => useSession())
    act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
    expect(window.customcluely.startTranscription).toHaveBeenCalledOnce()
  })

  it('toggling twice ends the session and stops transcription capture', () => {
    const { result } = renderHook(() => useSession())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(window.customcluely.stopTranscription).toHaveBeenCalledOnce()
  })

  it('exposes the live transcript segments from the composed transcript hook', () => {
    const { result } = renderHook(() => useSession())
    expect(Array.isArray(result.current.segments)).toBe(true)
  })

  it('a fresh start after a stop makes the session active again', () => {
    const { result } = renderHook(() => useSession())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
  })
})
