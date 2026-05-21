export type CodexEvent =
  | { kind: 'agent-text'; text: string }
  | { kind: 'turn-complete' }
  | { kind: 'turn-failed'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' }

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractText(item: Record<string, unknown>): string {
  if (typeof item.text === 'string') return item.text
  const content = item.content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object'
          ? asString((part as Record<string, unknown>).text)
          : '',
      )
      .join('')
  }
  return ''
}

export function parseCodexLine(line: string): CodexEvent {
  const trimmed = line.trim()
  if (trimmed.length === 0) return { kind: 'ignored' }

  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return { kind: 'ignored' }
    obj = parsed as Record<string, unknown>
  } catch {
    return { kind: 'ignored' }
  }

  const type = asString(obj.type)

  if (type === 'turn.failed') {
    const error = obj.error
    const message =
      error && typeof error === 'object'
        ? asString((error as Record<string, unknown>).message)
        : asString(error)
    return { kind: 'turn-failed', message: message || 'Codex turn failed.' }
  }

  if (type === 'error') {
    return { kind: 'error', message: asString(obj.message) || 'Codex reported an error.' }
  }

  if (type === 'turn.completed') return { kind: 'turn-complete' }

  if (type.startsWith('item.')) {
    const item = obj.item
    if (item && typeof item === 'object') {
      const itemObj = item as Record<string, unknown>
      const itemType = asString(itemObj.item_type) || asString(itemObj.type)
      if (itemType === 'agent_message') {
        const text = extractText(itemObj)
        if (text.length > 0) return { kind: 'agent-text', text }
      }
    }
  }

  return { kind: 'ignored' }
}
