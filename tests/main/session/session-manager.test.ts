import { describe, it, expect } from 'vitest'
import {
  createSession,
  startSession,
  stopSession,
  insightsEnabled,
  type SessionState
} from '../../../src/main/session/session-manager'

describe('session-manager', () => {
  it('starts idle', () => {
    expect(createSession().status).toBe('idle')
  })

  it('an idle session has insights disabled', () => {
    expect(insightsEnabled(createSession())).toBe(false)
  })

  it('starting an idle session makes it active', () => {
    const active = startSession(createSession())
    expect(active.status).toBe('active')
  })

  it('an active session has insights enabled', () => {
    expect(insightsEnabled(startSession(createSession()))).toBe(true)
  })

  it('stopping an active session makes it ended', () => {
    const ended = stopSession(startSession(createSession()))
    expect(ended.status).toBe('ended')
  })

  it('an ended session has insights disabled', () => {
    expect(insightsEnabled(stopSession(startSession(createSession())))).toBe(false)
  })

  it('starting an ended session begins a fresh active session', () => {
    const restarted = startSession(stopSession(startSession(createSession())))
    expect(restarted.status).toBe('active')
  })

  it('starting an already-active session is a no-op that stays active', () => {
    const once = startSession(createSession())
    const twice = startSession(once)
    expect(twice.status).toBe('active')
  })

  it('stopping an idle session is a no-op that stays idle', () => {
    const stopped = stopSession(createSession())
    expect(stopped.status).toBe('idle')
  })

  it('does not mutate the input state', () => {
    const idle: SessionState = createSession()
    startSession(idle)
    expect(idle.status).toBe('idle')
  })

  it('bumps the session id on each fresh start so a restart is distinguishable', () => {
    const first = startSession(createSession())
    const second = startSession(stopSession(first))
    expect(second.id).not.toBe(first.id)
  })
})
