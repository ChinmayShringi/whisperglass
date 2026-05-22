import { useCallback, useEffect, useState } from 'react'
import type {
  TranscriptSegment,
  TranscriptUpdatePayload,
  TranscriptionStatusPayload,
  SidecarStatusPayload
} from '../../../shared/types'

export interface UseTranscript {
  segments: TranscriptSegment[]
  ready: boolean
  statusDetail: string
  /** True while a listening session is active. */
  listening: boolean
  /** True while the capture sidecar is down and being restarted. */
  audioPaused: boolean
  /** Begins a listening session: tells main to start sidecar capture. */
  startListening: () => void
  /** Ends the listening session: tells main to stop sidecar capture. */
  stopListening: () => void
}

// Renderer-side transcription controller. In Phase 4 the renderer no longer
// captures audio: the Swift sidecar does. startListening/stopListening only
// notify the main process, which drives the sidecar supervisor. The hook
// subscribes to transcript updates, transcription status, and sidecar status
// (the last surfaces the "audio paused" banner while a crashed sidecar
// restarts).
export function useTranscript(): UseTranscript {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [ready, setReady] = useState(false)
  const [statusDetail, setStatusDetail] = useState('')
  const [listening, setListening] = useState(false)
  const [audioPaused, setAudioPaused] = useState(false)

  useEffect(() => {
    const offUpdate = window.whisperglass.onTranscriptUpdate((update: TranscriptUpdatePayload) =>
      setSegments(update.segments)
    )
    const offStatus = window.whisperglass.onTranscriptionStatus(
      (status: TranscriptionStatusPayload) => {
        setReady(status.ready)
        setStatusDetail(status.detail)
      }
    )
    const offSidecar = window.whisperglass.onSidecarStatus((status: SidecarStatusPayload) => {
      setAudioPaused(status.state === 'paused')
    })
    return () => {
      offUpdate()
      offStatus()
      offSidecar()
    }
  }, [])

  const startListening = useCallback(() => {
    setListening(true)
    window.whisperglass.startTranscription()
  }, [])

  const stopListening = useCallback(() => {
    setListening(false)
    window.whisperglass.stopTranscription()
  }, [])

  return {
    segments,
    ready,
    statusDetail,
    listening,
    audioPaused,
    startListening,
    stopListening
  }
}
