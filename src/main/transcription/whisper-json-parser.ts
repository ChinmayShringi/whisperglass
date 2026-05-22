export interface WhisperJsonResult {
  ok: boolean
  /** The joined, trimmed transcript text for the window. */
  text: string
}

// Parses the JSON file written by `whisper-cli --output-json`. The file shape
// is { "transcription": [ { "text": "<segment>", ... }, ... ] }. Each segment
// text is leading-space padded by whisper, so segments are trimmed and joined
// with single spaces. Pure and total: never throws.
export function parseWhisperJson(raw: string): WhisperJsonResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, text: '' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, text: '' }
  }
  const transcription = (parsed as Record<string, unknown>).transcription
  if (!Array.isArray(transcription)) {
    return { ok: false, text: '' }
  }
  const parts: string[] = []
  for (const segment of transcription) {
    if (segment && typeof segment === 'object') {
      const text = (segment as Record<string, unknown>).text
      if (typeof text === 'string') {
        const trimmed = text.trim()
        if (trimmed.length > 0) parts.push(trimmed)
      }
    }
  }
  return { ok: true, text: parts.join(' ') }
}
