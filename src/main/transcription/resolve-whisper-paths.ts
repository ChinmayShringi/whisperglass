import { join } from 'node:path'
import { WHISPER } from '../config/constants'

export interface ResolveWhisperPathsDeps {
  /** Absolute path to the app resources directory. */
  resourcesRoot: string
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
}

export interface WhisperPaths {
  binaryPath: string
  modelPath: string
  binaryPresent: boolean
  modelPresent: boolean
}

// Pure resolver for the bundled whisper.cpp binary and model. It never throws
// and never touches the real filesystem: existence is dependency-injected.
export function resolveWhisperPaths(deps: ResolveWhisperPathsDeps): WhisperPaths {
  const binaryPath = join(deps.resourcesRoot, 'whisper', WHISPER.binaryName)
  const modelPath = join(deps.resourcesRoot, 'whisper', WHISPER.modelFileName)
  return {
    binaryPath,
    modelPath,
    binaryPresent: deps.fileExists(binaryPath),
    modelPresent: deps.fileExists(modelPath)
  }
}
