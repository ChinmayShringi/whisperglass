// Removes the duplicated region where two consecutive overlapping whisper
// windows say the same words. Windows overlap by 2 s of audio, so the start
// of `next` repeats the end of `previous`. This finds the longest run of
// words at the end of `previous` that also begins `next`, and returns only
// the genuinely new words. Pure: matching is case-insensitive on tokenized
// words; the returned text preserves the original `next` casing and spacing.
export function dedupOverlap(previous: string, next: string): string {
  const nextWords = next.trim().split(/\s+/).filter((w) => w.length > 0)
  if (nextWords.length === 0) return ''

  const prevWords = previous.trim().split(/\s+/).filter((w) => w.length > 0)
  if (prevWords.length === 0) return nextWords.join(' ')

  const lower = (words: string[]): string[] => words.map((w) => w.toLowerCase())
  const prevLower = lower(prevWords)
  const nextLower = lower(nextWords)

  const maxOverlap = Math.min(prevLower.length, nextLower.length)
  let overlap = 0
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const prevTail = prevLower.slice(prevLower.length - size).join(' ')
    const nextHead = nextLower.slice(0, size).join(' ')
    if (prevTail === nextHead) {
      overlap = size
      break
    }
  }

  return nextWords.slice(overlap).join(' ')
}
