// Pure, total codec for the Swift sidecar's newline-delimited JSON stdio
// protocol (design spec section 11). parseSidecarLine never throws: any
// empty, malformed, or unrecognized line returns { kind: 'ignored' },
// mirroring the defensive parseCodexLine style. encodeSidecarCommand
// serializes a main-to-sidecar command to one newline-terminated JSON line.

/** A capture-source label as it appears on the wire. */
export type AudioSource = 'system' | 'mic'

/** A discriminated-union event decoded from one sidecar stdout line. */
export type SidecarEvent =
  | { kind: 'audio'; source: AudioSource; seq: number; sampleRate: number; pcm: string }
  | { kind: 'screenshot'; format: 'png'; dataBase64: string }
  | { kind: 'status'; state: string; detail: string }
  | { kind: 'permission'; permissionKind: 'screen' | 'mic'; granted: boolean }
  | { kind: 'ignored' }

/** A command sent from Electron main to the sidecar. */
export type SidecarCommand =
  | { type: 'start'; capture: string[]; appBundleId: string }
  | { type: 'screenshot' }
  | { type: 'stop' }
  | { type: 'shutdown' }

const IGNORED: SidecarEvent = { kind: 'ignored' }

function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

// Parses one line of sidecar stdout. Total: returns { kind: 'ignored' } for
// anything it cannot confidently interpret, and never throws.
export function parseSidecarLine(line: string): SidecarEvent {
  const trimmed = line.trim()
  if (trimmed.length === 0) return IGNORED
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return IGNORED
  }
  const object = asObject(parsed)
  if (!object) return IGNORED
  const type = object.type
  if (typeof type !== 'string') return IGNORED

  switch (type) {
    case 'audio': {
      const source = object.source
      const seq = object.seq
      const sampleRate = object.sampleRate
      const pcm = object.pcm
      if (
        (source === 'system' || source === 'mic') &&
        typeof seq === 'number' &&
        typeof sampleRate === 'number' &&
        typeof pcm === 'string'
      ) {
        return { kind: 'audio', source, seq, sampleRate, pcm }
      }
      return IGNORED
    }
    case 'screenshot': {
      const data = object.data
      if (typeof data === 'string') {
        return { kind: 'screenshot', format: 'png', dataBase64: data }
      }
      return IGNORED
    }
    case 'status': {
      const state = object.state
      const detail = object.detail
      if (typeof state === 'string') {
        return { kind: 'status', state, detail: typeof detail === 'string' ? detail : '' }
      }
      return IGNORED
    }
    case 'permission': {
      const kind = object.kind
      const granted = object.granted
      if ((kind === 'screen' || kind === 'mic') && typeof granted === 'boolean') {
        return { kind: 'permission', permissionKind: kind, granted }
      }
      return IGNORED
    }
    default:
      return IGNORED
  }
}

// Serializes a main-to-sidecar command to a single newline-terminated JSON
// line ready to write to the child's stdin.
export function encodeSidecarCommand(command: SidecarCommand): string {
  return `${JSON.stringify(command)}\n`
}
