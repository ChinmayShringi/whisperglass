import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ACTIONS,
  findDefaultAction
} from '../../../src/main/codex/default-actions'

describe('DEFAULT_ACTIONS', () => {
  it('defines exactly the five spec actions', () => {
    const ids = DEFAULT_ACTIONS.map((a) => a.id)
    expect(ids).toEqual(['say-next', 'follow-up', 'fact-check', 'recap', 'coding-help'])
  })

  it('gives every action a non-empty label and prompt template', () => {
    for (const action of DEFAULT_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0)
      expect(action.promptTemplate.length).toBeGreaterThan(0)
    }
  })

  it('adds --search only for the fact-check action', () => {
    for (const action of DEFAULT_ACTIONS) {
      if (action.id === 'fact-check') {
        expect(action.extraArgs).toContain('--search')
      } else {
        expect(action.extraArgs).not.toContain('--search')
      }
    }
  })

  it('labels the coding-help action as Smart Mode', () => {
    const coding = DEFAULT_ACTIONS.find((a) => a.id === 'coding-help')
    expect(coding?.label.toLowerCase()).toContain('coding')
  })
})

describe('findDefaultAction', () => {
  it('returns the matching action by id', () => {
    expect(findDefaultAction('recap')?.id).toBe('recap')
  })

  it('returns undefined for an unknown id', () => {
    expect(findDefaultAction('not-an-action')).toBeUndefined()
  })
})
