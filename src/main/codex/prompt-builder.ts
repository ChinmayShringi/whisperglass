const SYSTEM_INSTRUCTION = [
  'You are a real-time meeting copilot.',
  'Answer the question directly and concisely in plain text.',
  'No markdown, no headings, no preamble - a few sentences at most.',
  'If the question is ambiguous, give the most useful brief answer anyway.',
].join(' ')

export function buildPrompt(question: string): string {
  return `${SYSTEM_INSTRUCTION}\n\nQuestion: ${question.trim()}`
}
