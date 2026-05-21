import type { CodexStatus } from '../../shared/types'

export interface AvailabilityDeps {
  /** Resolves to the `codex --version` string, or null if the binary is missing. */
  getVersion: () => Promise<string | null>
  /** True when the Codex auth file (`~/.codex/auth.json`) exists. */
  authFileExists: () => boolean
}

export async function checkCodexAvailability(deps: AvailabilityDeps): Promise<CodexStatus> {
  const version = await deps.getVersion()
  if (version === null) {
    return {
      available: false,
      authenticated: false,
      detail: 'Codex CLI not found. Install it, then run `codex login`.',
    }
  }
  if (!deps.authFileExists()) {
    return {
      available: true,
      authenticated: false,
      detail: 'Codex CLI found but not logged in. Run `codex login` in a terminal.',
    }
  }
  return {
    available: true,
    authenticated: true,
    detail: `Codex ready (${version}).`,
  }
}
