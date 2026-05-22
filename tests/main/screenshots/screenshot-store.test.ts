import { describe, it, expect, vi } from 'vitest'
import { createScreenshotStore } from '../../../src/main/screenshots/screenshot-store'

describe('createScreenshotStore', () => {
  it('starts with no pending screenshot', () => {
    const store = createScreenshotStore({
      scratchRoot: '/scratch',
      writeFile: vi.fn(async () => {}),
      deleteFile: vi.fn(async () => {})
    })
    expect(store.pendingPath()).toBeUndefined()
  })

  it('saving a screenshot writes a PNG into the screenshots dir and tracks the path', async () => {
    const writeFile = vi.fn(async () => {})
    const store = createScreenshotStore({
      scratchRoot: '/scratch',
      writeFile,
      deleteFile: vi.fn(async () => {})
    })
    await store.save({ format: 'png', dataBase64: Buffer.from('img').toString('base64') })
    const path = store.pendingPath()
    expect(path).toBeDefined()
    expect(path?.startsWith('/scratch/screenshots/shot-')).toBe(true)
    expect(path?.endsWith('.png')).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
    const written = writeFile.mock.calls[0][1] as Buffer
    expect(written.toString()).toBe('img')
  })

  it('saving a second screenshot replaces the first and deletes the old file', async () => {
    const deleteFile = vi.fn(async () => {})
    const store = createScreenshotStore({
      scratchRoot: '/scratch',
      writeFile: vi.fn(async () => {}),
      deleteFile
    })
    await store.save({ format: 'png', dataBase64: 'AAAA' })
    const firstPath = store.pendingPath()
    await store.save({ format: 'png', dataBase64: 'BBBB' })
    expect(deleteFile).toHaveBeenCalledWith(firstPath)
    expect(store.pendingPath()).not.toBe(firstPath)
  })

  it('consuming the pending screenshot returns its path and clears it without deleting the file', async () => {
    const deleteFile = vi.fn(async () => {})
    const store = createScreenshotStore({
      scratchRoot: '/scratch',
      writeFile: vi.fn(async () => {}),
      deleteFile
    })
    await store.save({ format: 'png', dataBase64: 'AAAA' })
    const path = store.pendingPath()
    const consumed = store.consume()
    expect(consumed).toBe(path)
    expect(store.pendingPath()).toBeUndefined()
    // The Codex runner owns deleting the file after the query, so consume
    // must leave it on disk.
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('consuming when nothing is pending returns undefined and does not delete', () => {
    const deleteFile = vi.fn(async () => {})
    const store = createScreenshotStore({
      scratchRoot: '/scratch',
      writeFile: vi.fn(async () => {}),
      deleteFile
    })
    expect(store.consume()).toBeUndefined()
    expect(deleteFile).not.toHaveBeenCalled()
  })
})
