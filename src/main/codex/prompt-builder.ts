const SYSTEM_INSTRUCTION = [
  'You are a real-time meeting copilot.',
  'Answer the question directly and concisely in plain text.',
  'No markdown, no headings, no preamble - a few sentences at most.',
  'If the question is ambiguous, give the most useful brief answer anyway.',
  'When a meeting transcript is provided, ground your answer in it.'
].join(' ')

// Assembles the Codex prompt from the fixed system instruction, an optional
// bounded meeting-transcript context (produced by buildTranscriptContext),
// and the user's question. The transcript comes before the question so the
// model reads the meeting context first. An empty context is omitted
// entirely so a plain question prompt stays as small as before.
export function buildPrompt(question: string, transcriptContext: string): string {
  const parts = [SYSTEM_INSTRUCTION]
  const context = transcriptContext.trim()
  if (context.length > 0) {
    parts.push(`Meeting transcript:\n${context}`)
  }
  parts.push(`Question: ${question.trim()}`)
  return parts.join('\n\n')
}
