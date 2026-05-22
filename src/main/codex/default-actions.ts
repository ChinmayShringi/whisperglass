import type { DefaultActionId } from '../../shared/types'

export interface DefaultAction {
  /** Stable id, matches the DefaultActionId union. */
  id: DefaultActionId
  /** Button label shown in the renderer. */
  label: string
  /**
   * The question text fed to the Codex context-ask path. The rolling
   * transcript is attached separately by the prompt builder, so the
   * template is phrased as an instruction over "the meeting so far".
   */
  promptTemplate: string
  /** Extra codex flags this action contributes, for example `--search`. */
  extraArgs: string[]
}

// The five Default Actions cloned from Cluely Live Insights (design spec
// section 12). Each maps to a preset prompt fed to the existing Codex
// context-ask path. Only Fact check adds `--search`; the rest run a normal
// read-only query. Pure data: no I/O, fully unit-testable.
export const DEFAULT_ACTIONS: readonly DefaultAction[] = [
  {
    id: 'say-next',
    label: 'What should I say next',
    promptTemplate:
      'Based on the meeting so far, suggest what I should say next. Give one concise, natural response I could speak now.',
    extraArgs: []
  },
  {
    id: 'follow-up',
    label: 'Follow-up questions',
    promptTemplate:
      'Based on the meeting so far, suggest two or three sharp follow-up questions I could ask next.',
    extraArgs: []
  },
  {
    id: 'fact-check',
    label: 'Fact check',
    promptTemplate:
      'Fact check the most recent claims made in the meeting. State briefly whether each is accurate and correct anything wrong.',
    extraArgs: ['--search']
  },
  {
    id: 'recap',
    label: 'Recap',
    promptTemplate:
      'Recap the meeting so far in a few concise sentences: the key points and any decisions.',
    extraArgs: []
  },
  {
    id: 'coding-help',
    label: 'Coding help (Smart Mode)',
    promptTemplate:
      'Based on the meeting so far, give concise coding help for the technical problem under discussion.',
    extraArgs: []
  }
]

// Looks up a Default Action by id. Returns undefined for an unknown id.
export function findDefaultAction(id: string): DefaultAction | undefined {
  return DEFAULT_ACTIONS.find((action) => action.id === id)
}
