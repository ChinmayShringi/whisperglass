import { describe, it, expect } from 'vitest'
import { checkCodexAvailability } from '../../../src/main/codex/availability'

describe('checkCodexAvailability', () => {
  it('reports unavailable when the binary is missing', async () => {
    const status = await checkCodexAvailability({
      getVersion: async () => null,
      authFileExists: () => false,
    })
    expect(status.available).toBe(false)
    expect(status.authenticated).toBe(false)
    expect(status.detail).toContain('not found')
  })

  it('reports available but unauthenticated when there is no auth file', async () => {
    const status = await checkCodexAvailability({
      getVersion: async () => 'codex-cli 0.125.0',
      authFileExists: () => false,
    })
    expect(status.available).toBe(true)
    expect(status.authenticated).toBe(false)
    expect(status.detail).toContain('codex login')
  })

  it('reports ready when the binary and auth file are both present', async () => {
    const status = await checkCodexAvailability({
      getVersion: async () => 'codex-cli 0.125.0',
      authFileExists: () => true,
    })
    expect(status.available).toBe(true)
    expect(status.authenticated).toBe(true)
    expect(status.detail).toContain('0.125.0')
  })
})
