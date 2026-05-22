import { randomUUID } from 'node:crypto'
import type { TranscriptSegment } from '../../shared/types'

export interface TranscriptBuffer {
  readonly segments: readonly TranscriptSegment[]
}

// Creates an empty rolling transcript buffer.
export function createTranscriptBuffer(): TranscriptBuffer {
  return { segments: [] }
}

// Appends one transcript segment. The speaker hint is 'you' for microphone
// audio and 'them' for system audio (system audio arrives in Phase 4).
// Immutable: returns a new buffer and never mutates the input. Empty or
// whitespace-only text is ignored so silent windows add nothing.
export function appendSegment(
  buffer: TranscriptBuffer,
  speaker: TranscriptSegment['speaker'],
  text: string
): TranscriptBuffer {
  const trimmed = text.trim()
  if (trimmed.length === 0) return buffer
  const segment: TranscriptSegment = { id: randomUUID(), speaker, text: trimmed }
  return { segments: [...buffer.segments, segment] }
}

// Reads all segments in append order as a defensive mutable copy.
export function readSegments(buffer: TranscriptBuffer): TranscriptSegment[] {
  return buffer.segments.map((segment) => ({ ...segment }))
}
