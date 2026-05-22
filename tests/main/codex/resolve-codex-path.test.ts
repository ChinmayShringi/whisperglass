import { describe, it, expect } from 'vitest'
import { resolveCodexPath } from '../../../src/main/codex/resolve-codex-path'

describe('resolveCodexPath', () => {
  it('returns the first known path that exists, preferring it over later ones', () => {
    const path = resolveCodexPath({
      fileExists: (p) => p === '/opt/homebrew/bin/codex' || p === '/usr/local/bin/codex',
      runWhich: () => null
    })
    expect(path).toBe('/opt/homebrew/bin/codex')
  })

  it('returns the second known path when the first is missing', () => {
    const path = resolveCodexPath({
      fileExists: (p) => p === '/usr/local/bin/codex',
      runWhich: () => null
    })
    expect(path).toBe('/usr/local/bin/codex')
  })

  it('falls back to an absolute which result when no known path exists', () => {
    const path = resolveCodexPath({
      fileExists: (p) => p === '/some/custom/bin/codex',
      runWhich: () => '/some/custom/bin/codex'
    })
    expect(path).toBe('/some/custom/bin/codex')
  })

  it('rejects a relative path returned by which', () => {
    const path = resolveCodexPath({
      fileExists: () => false,
      runWhich: () => 'codex'
    })
    expect(path).toBeNull()
  })

  it('rejects a null which result', () => {
    const path = resolveCodexPath({
      fileExists: () => false,
      runWhich: () => null
    })
    expect(path).toBeNull()
  })

  it('rejects an absolute which result that does not exist on disk', () => {
    const path = resolveCodexPath({
      fileExists: () => false,
      runWhich: () => '/ghost/bin/codex'
    })
    expect(path).toBeNull()
  })

  it('returns null when nothing is found anywhere', () => {
    const path = resolveCodexPath({
      fileExists: () => false,
      runWhich: () => ''
    })
    expect(path).toBeNull()
  })
})
