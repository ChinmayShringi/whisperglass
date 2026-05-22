import type { TranscriptSegment } from '../../shared/types'

export interface TranscriptContextOptions {
  /** How many of the most recent segments are kept verbatim. */
  recentSegments: number
  /** Character budget for the compacted digest of older segments. */
  olderCharBudget: number
  /** Prefix line that introduces the older-segment digest. */
  olderMarker: string
}

// Renders one segment as a speaker-prefixed line.
function renderLine(segment: TranscriptSegment): string {
  return `${segment.speaker}: ${segment.text.trim()}`
}

// Pure rolling transcript summarizer. As a meeting runs long the raw
// transcript would blow up the Codex prompt, so this keeps the prompt
// bounded: the most recent `recentSegments` segments are rendered verbatim,
// and everything older is compacted into a single digest truncated to
// `olderCharBudget` characters and introduced by `olderMarker`. It makes no
// Codex call: the compaction is a deterministic character-budget truncation,
// so the result is instant and fully testable. Never mutates the input.
export function buildTranscriptContext(
  segments: readonly TranscriptSegment[],
  options: TranscriptContextOptions
): string {
  if (segments.length === 0) return ''

  const recentCount = Math.max(0, options.recentSegments)
  const splitAt = Math.max(0, segments.length - recentCount)
  const older = segments.slice(0, splitAt)
  const recent = segments.slice(splitAt)

  const recentText = recent.map(renderLine).join('\n')

  if (older.length === 0) {
    return recentText
  }

  // Compact the older segments into one budgeted digest. The join is
  // truncated from the end so the digest never exceeds the budget; the
  // marker line is always kept in full.
  const olderJoined = older.map(renderLine).join('\n')
  const digestBody =
    olderJoined.length > options.olderCharBudget
      ? `${olderJoined.slice(0, options.olderCharBudget).trimEnd()}...`
      : olderJoined
  const digest = `${options.olderMarker}\n${digestBody}`

  return recentText.length > 0 ? `${digest}\n${recentText}` : digest
}
