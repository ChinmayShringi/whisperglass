import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { ListenToggle } from './components/ListenToggle'
import { SetupBanner } from './components/SetupBanner'
import { DefaultActions } from './components/DefaultActions'
import { InsightList } from './components/InsightList'
import { useCodexAnswer } from './hooks/useCodexAnswer'
import { useSession } from './hooks/useSession'
import { useInsights } from './hooks/useInsights'
import { findDefaultAction } from '../../main/codex/default-actions'
import type { Insight } from './insights/detect-insights'
import type { OverlayState, CodexStatus, DefaultActionId } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, askContext, retry } = useCodexAnswer()
  const { active, toggle, segments, audioPaused } = useSession()
  const { insights, firstInsight } = useInsights(segments, active)

  const busy = state.status === 'streaming'

  useEffect(() => {
    const offState = window.whisperglass.onOverlayState((overlay: OverlayState) => {
      setInvisible(overlay.invisible)
    })
    const offStatus = window.whisperglass.onCodexStatus((status: CodexStatus) => {
      setSetupMessage(status.available && status.authenticated ? null : status.detail)
    })
    return () => {
      offState()
      offStatus()
    }
  }, [])

  // Runs a Default Action: its preset prompt and codex-arg modifiers are fed
  // to the transcript-aware context-ask path.
  function runDefaultAction(id: DefaultActionId): void {
    const action = findDefaultAction(id)
    if (!action) return
    askContext(action.promptTemplate, segments, {
      screenshot: false,
      extraArgs: [...action.extraArgs]
    })
  }

  // Answers one dynamic insight via the context-ask path.
  function answerInsight(insight: Insight): void {
    askContext(insight.label, segments, { screenshot: false, extraArgs: [] })
  }

  // Renderer-local hotkeys (design spec section 13). Tab answers the first
  // dynamic insight; Cmd+Shift+S captures a screenshot. Tab is ignored while
  // a text input or textarea is focused so normal typing still works.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (event.key === 'Tab' && !typing) {
        if (firstInsight && !busy) {
          event.preventDefault()
          answerInsight(firstInsight)
        }
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        window.whisperglass.requestScreenshot()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="app">
      <SetupBanner message={setupMessage} />
      {audioPaused && (
        <p className="app__audio-paused" role="status">
          Audio paused, reconnecting capture...
        </p>
      )}
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={busy} />
        <button
          className="command-bar__screenshot"
          aria-label="Capture screenshot"
          onClick={() => window.whisperglass.requestScreenshot()}
        >
          Screenshot
        </button>
        <ListenToggle listening={active} onToggle={toggle} />
        <EyeToggle
          invisible={invisible}
          onToggle={() => window.whisperglass.toggleInvisibility()}
        />
      </div>
      <DefaultActions onAction={runDefaultAction} disabled={busy} />
      {active && <InsightList insights={insights} onAnswer={answerInsight} disabled={busy} />}
      {state.question.length > 0 && <p className="app__active-question">{state.question}</p>}
      <AnswerPanel answer={state.text} status={state.status} error={state.error} onRetry={retry} />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
