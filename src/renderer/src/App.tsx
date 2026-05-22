import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { ListenToggle } from './components/ListenToggle'
import { SetupBanner } from './components/SetupBanner'
import { useCodexAnswer } from './hooks/useCodexAnswer'
import { useTranscript } from './hooks/useTranscript'
import type { OverlayState, CodexStatus } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, retry } = useCodexAnswer()
  const { segments, listening, audioPaused, startListening, stopListening } = useTranscript()

  useEffect(() => {
    const offState = window.customcluely.onOverlayState((overlay: OverlayState) => {
      setInvisible(overlay.invisible)
    })
    const offStatus = window.customcluely.onCodexStatus((status: CodexStatus) => {
      setSetupMessage(status.available && status.authenticated ? null : status.detail)
    })
    return () => {
      offState()
      offStatus()
    }
  }, [])

  return (
    <div className="app">
      <SetupBanner message={setupMessage} />
      {audioPaused && (
        <p className="app__audio-paused" role="status">
          Audio paused, reconnecting capture...
        </p>
      )}
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={state.status === 'streaming'} />
        <ListenToggle
          listening={listening}
          onToggle={() => (listening ? stopListening() : startListening())}
        />
        <EyeToggle invisible={invisible} onToggle={() => window.customcluely.toggleInvisibility()} />
      </div>
      {state.question.length > 0 && <p className="app__active-question">{state.question}</p>}
      <AnswerPanel answer={state.text} status={state.status} error={state.error} onRetry={retry} />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
