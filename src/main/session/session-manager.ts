/** The lifecycle status of a meeting session. */
export type SessionStatus = 'idle' | 'active' | 'ended'

export interface SessionState {
  /** Where the session is in its lifecycle. */
  readonly status: SessionStatus
  /**
   * A counter that increments on every fresh start. It distinguishes one
   * meeting session from the next so a restart never inherits stale state.
   */
  readonly id: number
}

// Creates a fresh idle session. No meeting is running and no insights show.
export function createSession(): SessionState {
  return { status: 'idle', id: 0 }
}

// Starts a meeting session. From `idle` or `ended` this begins a new active
// session with a bumped id; an already-active session is returned unchanged.
// Immutable: returns a new state, never mutates the input.
export function startSession(state: SessionState): SessionState {
  if (state.status === 'active') return state
  return { status: 'active', id: state.id + 1 }
}

// Stops a meeting session. An active session becomes `ended` (its state is
// frozen); an idle session is returned unchanged. Immutable.
export function stopSession(state: SessionState): SessionState {
  if (state.status !== 'active') return state
  return { status: 'ended', id: state.id }
}

// True only while a session is active. The overlay surfaces dynamic insights
// only when this is true, using a session-scoped insight model.
export function insightsEnabled(state: SessionState): boolean {
  return state.status === 'active'
}
