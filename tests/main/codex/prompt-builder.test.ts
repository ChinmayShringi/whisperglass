import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../../../src/main/codex/prompt-builder'

describe('buildPrompt', () => {
  it('includes the question text', () => {
    const prompt = buildPrompt('What is a closure?', '')
    expect(prompt).toContain('What is a closure?')
  })

  it('trims the question', () => {
    const prompt = buildPrompt('  spaced out  ', '')
    expect(prompt).toContain('Question: spaced out')
    expect(prompt).not.toContain('  spaced out  ')
  })

  it('states the real-time meeting copilot role', () => {
    const prompt = buildPrompt('hi', '')
    expect(prompt.toLowerCase()).toContain('meeting copilot')
  })

  it('omits the transcript section when the context is empty', () => {
    const prompt = buildPrompt('hi', '')
    expect(prompt).not.toContain('Meeting transcript:')
  })

  it('includes the transcript context when one is given', () => {
    const prompt = buildPrompt('What did they decide?', 'you: we should ship\nthem: agreed')
    expect(prompt).toContain('Meeting transcript:')
    expect(prompt).toContain('you: we should ship')
    expect(prompt).toContain('them: agreed')
  })

  it('puts the transcript before the question', () => {
    const prompt = buildPrompt('what was decided', 'you: the transcript')
    expect(prompt.indexOf('you: the transcript')).toBeLessThan(prompt.indexOf('what was decided'))
  })
})
