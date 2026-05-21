import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../../../src/main/codex/prompt-builder'

describe('buildPrompt', () => {
  it('includes the meeting-copilot system instruction', () => {
    const prompt = buildPrompt('What is a closure?')
    expect(prompt.toLowerCase()).toContain('meeting copilot')
    expect(prompt.toLowerCase()).toContain('concise')
  })

  it('includes the question under a Question label', () => {
    expect(buildPrompt('What is a closure?')).toContain('Question: What is a closure?')
  })

  it('trims surrounding whitespace from the question', () => {
    expect(buildPrompt('  hello  ')).toContain('Question: hello')
  })
})
