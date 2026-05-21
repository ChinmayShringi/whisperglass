import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount any React trees rendered by @testing-library/react after each test.
// Auto-cleanup only fires when Vitest globals are enabled; this config uses
// explicit imports, so register it manually here. cleanup() is a no-op for
// tests that render nothing, so it is safe for the node-environment suites.
afterEach(() => {
  cleanup()
})
