import { describe, it, expect } from 'vitest'
import { resolveSidecarPath } from '../../../src/main/transcription/resolve-sidecar-path'

describe('resolveSidecarPath', () => {
  it('builds the binary path under the resources root', () => {
    const result = resolveSidecarPath({
      resourcesRoot: '/app/resources',
      fileExists: () => true
    })
    expect(result.binaryPath).toBe('/app/resources/sidecar/customcluely-sidecar')
  })

  it('reports the binary present when the file exists', () => {
    const result = resolveSidecarPath({
      resourcesRoot: '/app/resources',
      fileExists: (p) => p === '/app/resources/sidecar/customcluely-sidecar'
    })
    expect(result.binaryPresent).toBe(true)
  })

  it('reports the binary missing when the file does not exist', () => {
    const result = resolveSidecarPath({
      resourcesRoot: '/app/resources',
      fileExists: () => false
    })
    expect(result.binaryPresent).toBe(false)
  })
})
