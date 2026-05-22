import { CODEX } from '../config/constants'

export interface ResolveCodexPathDeps {
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
  /** Resolves `codex` via the `which` binary, or null when it cannot be found. */
  runWhich: () => string | null
}

// Resolves the codex binary to an absolute path, avoiding a PATH-lookup
// hijack surface. Pure and dependency-injected: it never touches the real
// filesystem and never throws.
export function resolveCodexPath(deps: ResolveCodexPathDeps): string | null {
  for (const candidate of CODEX.knownPaths) {
    if (deps.fileExists(candidate)) return candidate
  }
  const fromWhich = deps.runWhich()
  if (fromWhich && fromWhich.startsWith('/') && deps.fileExists(fromWhich)) {
    return fromWhich
  }
  return null
}
