import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ScreenshotPayload } from '../../shared/types'

export interface ScreenshotStoreDeps {
  /** The Codex scratch root; screenshots go in its `screenshots/` subdir. */
  scratchRoot: string
  /** Writes a file. Dependency-injected so the store is unit-testable. */
  writeFile: (path: string, data: Buffer) => Promise<void>
  /** Deletes a file; must not throw if the file is already gone. */
  deleteFile: (path: string) => Promise<void>
}

export interface ScreenshotStore {
  /** Decodes and writes a sidecar screenshot, replacing any pending one. */
  save: (payload: ScreenshotPayload) => Promise<void>
  /** The path of the pending screenshot, or undefined when none is pending. */
  pendingPath: () => string | undefined
  /**
   * Returns the pending screenshot path and clears it, deleting the file.
   * Returns undefined when nothing is pending. Called after a query has
   * attached the screenshot so it is used exactly once.
   */
  consume: () => Promise<string | undefined>
}

// Holds at most one pending screenshot. Sidecar screenshots arrive as base64
// PNGs; this store decodes them to real files in the Codex scratch dir so the
// Codex runner can attach them with `-i`. A new screenshot replaces the old
// one (its file is deleted), and consuming the pending screenshot deletes its
// file too, so screenshots never accumulate on disk.
export function createScreenshotStore(deps: ScreenshotStoreDeps): ScreenshotStore {
  const screenshotsDir = join(deps.scratchRoot, 'screenshots')
  let pending: string | undefined

  async function discardPending(): Promise<void> {
    if (pending) {
      const old = pending
      pending = undefined
      await deps.deleteFile(old).catch(() => {})
    }
  }

  async function save(payload: ScreenshotPayload): Promise<void> {
    await discardPending()
    const path = join(screenshotsDir, `shot-${randomUUID()}.png`)
    await deps.writeFile(path, Buffer.from(payload.dataBase64, 'base64'))
    pending = path
  }

  function pendingPath(): string | undefined {
    return pending
  }

  async function consume(): Promise<string | undefined> {
    const path = pending
    if (!path) return undefined
    pending = undefined
    await deps.deleteFile(path).catch(() => {})
    return path
  }

  return { save, pendingPath, consume }
}
