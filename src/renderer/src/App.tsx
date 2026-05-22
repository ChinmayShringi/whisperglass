import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { SetupBanner } from './components/SetupBanner'
import type { OverlayState, TranscriptSegment } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [activeQuestion, setActiveQuestion] = useState('')
  const [segments] = useState<TranscriptSegment[]>([])

  useEffect(() => {
    const unsubscribe = window.customcluely.onOverlayState((state: OverlayState) => {
      setInvisible(state.invisible)
    })
    return unsubscribe
  }, [])

  return (
    <div className="app">
      <SetupBanner message={null} />
      <div className="app__bar">
        <CommandBar onSubmit={setActiveQuestion} />
        <EyeToggle invisible={invisible} onToggle={() => window.customcluely.toggleInvisibility()} />
      </div>
      {activeQuestion.length > 0 && (
        <p className="app__active-question">{activeQuestion}</p>
      )}
      <AnswerPanel answer="" />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
