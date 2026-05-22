import React, { useCallback, useEffect, useRef, useState } from 'react'
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

// Wait this long after a question-style insight first surfaces before
// auto-answering it. Gives the speaker a moment to keep talking or for the
// user to intervene; long enough that we do not race the next transcript
// window arriving.
const AUTO_ANSWER_DELAY_MS = 1500

// How long the "screenshot captured" toast remains visible after a successful
// capture. Independent from how long the screenshot stays pending for the
// next action: the toast is purely a UI confirmation.
const SCREENSHOT_TOAST_MS = 2000

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, askContext, retry } = useCodexAnswer()
  const { active, toggle, segments, audioPaused } = useSession()
  const { insights, firstInsight } = useInsights(segments, active)

  // True between a Screenshot capture and the next context-ask that consumes
  // it. The main process always has the file on disk; this flag controls
  // whether the renderer asks the codex runner to attach it via `-i`.
  const [screenshotPending, setScreenshotPending] = useState(false)
  // Transient UI confirmation that a screenshot just landed.
  const [screenshotToast, setScreenshotToast] = useState(false)

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

  // Subscribe to sidecar screenshot deliveries. Each capture flips the
  // pending flag on and shows a brief toast; a follow-up capture replaces
  // the previous pending shot (matching screenshotStore.save which discards
  // the old file).
  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    const off = window.whisperglass.onScreenshot(() => {
      setScreenshotPending(true)
      setScreenshotToast(true)
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => setScreenshotToast(false), SCREENSHOT_TOAST_MS)
    })
    return () => {
      off()
      if (toastTimer) clearTimeout(toastTimer)
    }
  }, [])

  // Runs a Default Action: its preset prompt and codex-arg modifiers are fed
  // to the transcript-aware context-ask path. Attaches the pending
  // screenshot if one is queued and clears the pending flag the same call.
  const runDefaultAction = useCallback(
    (id: DefaultActionId): void => {
      const action = findDefaultAction(id)
      if (!action) return
      askContext(action.promptTemplate, segments, {
        screenshot: screenshotPending,
        extraArgs: [...action.extraArgs]
      })
      if (screenshotPending) setScreenshotPending(false)
    },
    [askContext, segments, screenshotPending]
  )

  // Answers one dynamic insight via the context-ask path. Same screenshot
  // consume semantics as runDefaultAction.
  const answerInsight = useCallback(
    (insight: Insight): void => {
      askContext(insight.label, segments, {
        screenshot: screenshotPending,
        extraArgs: []
      })
      if (screenshotPending) setScreenshotPending(false)
    },
    [askContext, segments, screenshotPending]
  )

  // Auto-answer detected questions while listening. The effect re-runs when
  // firstInsight.id changes, when busy flips, or when active flips; the ref
  // pattern keeps answerInsight out of the dependency list so we do not
  // reschedule on every 8s transcript window. Each insight id is answered at
  // most once: the Set is a renderer-only de-dup ledger.
  const answerInsightRef = useRef(answerInsight)
  useEffect(() => {
    answerInsightRef.current = answerInsight
  }, [answerInsight])
  const answeredInsightIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!active || busy || !firstInsight) return
    if (firstInsight.kind !== 'question') return
    if (answeredInsightIdsRef.current.has(firstInsight.id)) return
    const insight = firstInsight
    const timer = setTimeout(() => {
      if (answeredInsightIdsRef.current.has(insight.id)) return
      answeredInsightIdsRef.current.add(insight.id)
      answerInsightRef.current(insight)
    }, AUTO_ANSWER_DELAY_MS)
    return () => clearTimeout(timer)
    // We intentionally depend on the insight id, not the object reference,
    // so a stable question across consecutive 8s transcript windows does not
    // keep resetting the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstInsight?.id, firstInsight?.kind, active, busy])

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
      {screenshotToast && (
        <p className="app__toast" role="status">
          Screenshot captured, attached to next action
        </p>
      )}
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={busy} />
        <button
          className={
            screenshotPending
              ? 'command-bar__screenshot command-bar__screenshot--pending'
              : 'command-bar__screenshot'
          }
          aria-label="Capture screenshot"
          aria-pressed={screenshotPending}
          onClick={() => window.whisperglass.requestScreenshot()}
        >
          {screenshotPending ? 'Screenshot ready' : 'Screenshot'}
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
