import type { TranscriptSegment } from '../../shared/types'

/** One detected insight surfaced below the command bar. */
export interface Insight {
  /** Stable id derived from the source segment. */
  id: string
  /** Whether this insight is a detected question or a keyword hit. */
  kind: 'question' | 'keyword'
  /** The transcript segment this insight came from. */
  sourceSegmentId: string
  /** Short, prompt-ready label shown in the UI and used to answer it. */
  label: string
}

export interface DetectInsightsOptions {
  /** Lowercase salient terms; matched case-insensitively as substrings. */
  keywords: readonly string[]
  /** The result is capped at this many insights. */
  maxSurfaced: number
}

// Words that, as the first token of a segment, mark it as a question even
// without a trailing question mark.
const INTERROGATIVES = new Set([
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'which',
  'whose',
  'can',
  'could',
  'should',
  'would',
  'do',
  'does',
  'did',
  'is',
  'are',
  'will'
])

// Normalizes text for de-duplication: lowercased, trimmed, collapsed spaces.
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

// True when the segment text reads as a question: a trailing '?' or an
// interrogative first word.
function isQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (trimmed.endsWith('?')) return true
  const firstWord = trimmed.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '')
  return INTERROGATIVES.has(firstWord)
}

// True when the segment text contains any salient keyword.
function hasKeyword(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((keyword) => lower.includes(keyword))
}

// Pure rule-based dynamic insight detector. It scans every transcript
// segment, flags the ones that read as a question or carry a salient
// keyword, ranks questions before keyword hits (each group kept in
// transcript order), de-duplicates by normalized text, and caps the result.
// No model and no network: every rule is deterministic, so the whole module
// is unit-testable. Never mutates the input.
export function detectInsights(
  segments: readonly TranscriptSegment[],
  options: DetectInsightsOptions
): Insight[] {
  const questions: Insight[] = []
  const keywords: Insight[] = []
  const seen = new Set<string>()

  for (const segment of segments) {
    const text = segment.text.trim()
    if (text.length === 0) continue
    const key = normalize(text)
    if (seen.has(key)) continue

    if (isQuestion(text)) {
      seen.add(key)
      questions.push({
        id: `insight-${segment.id}`,
        kind: 'question',
        sourceSegmentId: segment.id,
        label: text
      })
    } else if (hasKeyword(text, options.keywords)) {
      seen.add(key)
      keywords.push({
        id: `insight-${segment.id}`,
        kind: 'keyword',
        sourceSegmentId: segment.id,
        label: text
      })
    }
  }

  return [...questions, ...keywords].slice(0, Math.max(0, options.maxSurfaced))
}
