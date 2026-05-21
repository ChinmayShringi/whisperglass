import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { SetupBanner } from './components/SetupBanner'
import { useCodexAnswer } from './hooks/useCodexAnswer'
import type { OverlayState, TranscriptSegment, CodexStatus } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [segments] = useState<TranscriptSegment[]>([])
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, retry } = useCodexAnswer()

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
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={state.status === 'streaming'} />
        <EyeToggle invisible={invisible} onToggle={() => window.customcluely.toggleInvisibility()} />
      </div>
      {state.question.length > 0 && <p className="app__active-question">{state.question}</p>}
      <AnswerPanel answer={state.text} status={state.status} error={state.error} onRetry={retry} />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
