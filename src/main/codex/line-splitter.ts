export interface SplitResult {
  lines: string[]
  rest: string
}

export function splitLines(buffer: string, chunk: string): SplitResult {
  const parts = (buffer + chunk).split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}
