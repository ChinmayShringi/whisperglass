import { useCallback, useState } from 'react'
import { useTranscript } from './useTranscript'
import {
  createSession,
  startSession,
  stopSession,
  insightsEnabled,
  type SessionState
} from '../../../main/session/session-manager'
import type { TranscriptSegment } from '../../../shared/types'

export interface UseSession {
  /** True while a meeting session is active. */
  active: boolean
  /** Starts a session when inactive, stops it when active. */
  toggle: () => void
  /** Live transcript segments from the composed useTranscript hook. */
  segments: TranscriptSegment[]
  /** True while the capture sidecar is down and being restarted. */
  audioPaused: boolean
}

// Composes the Phase 3/4 useTranscript capture hook with the pure session
// state machine. Starting a session both starts sidecar capture (which clears
// the main-process transcript) and moves the session to `active`, which is
// what gates insight detection. Stopping a session stops capture and freezes
// the session. The renderer's existing ListenToggle drives `toggle`; this
// hook supersedes the bare listen toggle conceptually while reusing the
// useTranscript plumbing unchanged.
export function useSession(): UseSession {
  const transcript = useTranscript()
  const [session, setSession] = useState<SessionState>(createSession)

  const toggle = useCallback(() => {
    setSession((current) => {
      if (insightsEnabled(current)) {
        transcript.stopListening()
        return stopSession(current)
      }
      transcript.startListening()
      return startSession(current)
    })
  }, [transcript])

  return {
    active: insightsEnabled(session),
    toggle,
    segments: transcript.segments,
    audioPaused: transcript.audioPaused
  }
}
