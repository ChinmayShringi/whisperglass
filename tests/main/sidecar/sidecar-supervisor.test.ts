import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { createSidecarSupervisor } from '../../../src/main/sidecar/sidecar-supervisor'

const FIXTURES = join(__dirname, '../../fixtures/sidecar')

function makeCallbacks() {
  return {
    onAudio: vi.fn(),
    onScreenshot: vi.fn(),
    onStatus: vi.fn(),
    onPermission: vi.fn()
  }
}

describe('createSidecarSupervisor', () => {
  it('spawns the sidecar and routes a status event to onStatus', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => {
      expect(callbacks.onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'capturing' })
      )
    })
    await supervisor.shutdown()
  })

  it('routes an audio event to onAudio after start', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => {
      expect(callbacks.onAudio).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'mic', pcm: 'QUJD' })
      )
    })
    await supervisor.shutdown()
  })

  it('delivers a screenshot event to onScreenshot when requestScreenshot is called', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => expect(callbacks.onStatus).toHaveBeenCalled())
    supervisor.requestScreenshot()
    await vi.waitFor(() => {
      expect(callbacks.onScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'png', dataBase64: 'aW1n' })
      )
    })
    await supervisor.shutdown()
  })

  it('emits a paused status and re-spawns the child when the sidecar crashes', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar-crash.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    // The crash fixture exits 1 on every run. A correct supervisor goes:
    // crash 1 -> paused -> re-spawn -> the re-spawned child crashes -> paused
    // again. A second distinct paused event can only happen if scheduleRestart
    // genuinely re-spawned the child, so >= 2 paused events proves the
    // re-spawn. If scheduleRestart/spawnChild were removed this would time out.
    await vi.waitFor(() => {
      const pausedCount = callbacks.onStatus.mock.calls.filter(
        (call) => (call[0] as { state: string }).state === 'paused'
      ).length
      expect(pausedCount).toBeGreaterThanOrEqual(2)
    })
    await supervisor.shutdown()
  })

  it('emits an error status and schedules a restart when spawn fails', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: '/nonexistent/customcluely-sidecar-binary',
      prefixArgs: [],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    // A non-existent command makes spawn emit an 'error' event, which the
    // supervisor surfaces as a 'error' status and then schedules a restart.
    // The restart spawns the same bad command, which errors again, so >= 2
    // 'error' statuses proves the proc.on('error') branch also re-schedules.
    await vi.waitFor(() => {
      const errorCount = callbacks.onStatus.mock.calls.filter(
        (call) => (call[0] as { state: string }).state === 'error'
      ).length
      expect(errorCount).toBeGreaterThanOrEqual(2)
    })
    await supervisor.shutdown()
  })

  it('does not restart after an intentional shutdown', async () => {
    const callbacks = makeCallbacks()
    const supervisor = createSidecarSupervisor({
      command: 'node',
      prefixArgs: [join(FIXTURES, 'mock-sidecar.mjs')],
      appBundleId: 'com.customcluely.app',
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      stableUptimeMs: 10_000,
      ...callbacks
    })
    supervisor.start()
    await vi.waitFor(() => expect(callbacks.onStatus).toHaveBeenCalled())
    await supervisor.shutdown()
    callbacks.onStatus.mockClear()
    // Give any erroneous restart time to fire.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(callbacks.onStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: 'capturing' })
    )
  })
})
