import { join } from 'node:path'
import { SIDECAR } from '../config/constants'

export interface ResolveSidecarPathDeps {
  /** Absolute path to the app resources directory. */
  resourcesRoot: string
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
}

export interface SidecarPaths {
  binaryPath: string
  binaryPresent: boolean
}

// Pure resolver for the bundled Swift capture sidecar binary. It never throws
// and never touches the real filesystem: existence is dependency-injected.
// Mirrors resolveWhisperPaths.
export function resolveSidecarPath(deps: ResolveSidecarPathDeps): SidecarPaths {
  const binaryPath = join(deps.resourcesRoot, 'sidecar', SIDECAR.binaryName)
  return {
    binaryPath,
    binaryPresent: deps.fileExists(binaryPath)
  }
}
