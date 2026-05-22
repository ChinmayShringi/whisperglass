import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TranscriptSegment,
  TranscriptUpdatePayload,
  TranscriptionStatusPayload
} from '../../../shared/types'
import { startCapture, type MicCaptureHandle } from '../audio/mic-capture'

export interface UseTranscript {
  segments: TranscriptSegment[]
  ready: boolean
  statusDetail: string
  /** True while a microphone listening session is active. */
  listening: boolean
  /** Begins a listening session: prompts for the mic and starts capture. */
  startListening: () => void
  /** Ends the listening session: releases the mic and resets rolling state. */
  stopListening: () => void
}

// Renderer-side transcription controller. It subscribes to transcript updates
// and transcription status from the main process, and exposes an explicit
// start/stop listening session. Capture (and the macOS microphone permission
// prompt) is never started on mount: only startListening triggers it. Mirrors
// the useCodexAnswer hook pattern: an effect wires the IPC subscriptions,
// callbacks drive the imperative actions.
export function useTranscript(): UseTranscript {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [ready, setReady] = useState(false)
  const [statusDetail, setStatusDetail] = useState('')
  const [listening, setListening] = useState(false)
  const captureRef = useRef<MicCaptureHandle | null>(null)

  useEffect(() => {
    const offUpdate = window.customcluely.onTranscriptUpdate(
      (update: TranscriptUpdatePayload) => setSegments(update.segments)
    )
    const offStatus = window.customcluely.onTranscriptionStatus(
      (status: TranscriptionStatusPayload) => {
        setReady(status.ready)
        setStatusDetail(status.detail)
      }
    )
    return () => {
      offUpdate()
      offStatus()
      void captureRef.current?.stopCapture()
      captureRef.current = null
    }
  }, [])

  const startListening = useCallback(() => {
    if (captureRef.current) return
    setListening(true)
    // Tell main to reset its rolling audio state for a fresh session.
    window.customcluely.startTranscription()
    void startCapture({
      onFrame: (pcmBase64) => window.customcluely.sendAudioFrame({ pcmBase64 }),
      onError: (message) => {
        setStatusDetail(message)
        setListening(false)
      }
    }).then((handle) => {
      captureRef.current = handle
    })
  }, [])

  const stopListening = useCallback(() => {
    setListening(false)
    window.customcluely.stopTranscription()
    void captureRef.current?.stopCapture()
    captureRef.current = null
  }, [])

  return { segments, ready, statusDetail, listening, startListening, stopListening }
}
