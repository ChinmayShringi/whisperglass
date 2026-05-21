# Phase 1: Overlay Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A transparent, always-on-top, frameless macOS overlay with a black-and-white UI, global hotkeys, a manual text input, and an opt-in invisibility toggle that hides the window from screen capture.

**Architecture:** An Electron app scaffolded with electron-vite. The main process owns the overlay window, global hotkeys, and content protection. The renderer (React) draws the UI. Pure logic is split into files that import only TypeScript types, so it is unit-testable without an Electron runtime; Electron glue takes its dependencies as parameters for the same reason.

**Tech Stack:** Electron, TypeScript, electron-vite, React, Vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-20-cluely-clone-design.md`
**Roadmap:** `docs/superpowers/plans/2026-05-20-roadmap.md`

**Execution:** Each task below runs through the 3-agent pipeline (Implementer, Auditor, Documenter) defined in the roadmap. The task content is what the Implementer follows; the Auditor re-derives tests and audits against this plan and the spec; the Documenter commits.

---

## File map for Phase 1

Created or modified across the tasks:

| Path | Responsibility | Task |
|---|---|---|
| `src/shared/types.ts` | Cross-process types and IPC channel names | T1.2 |
| `src/main/config/constants.ts` | Overlay dimensions, global hotkey table | T1.2 |
| `src/main/windows/overlay-window-options.ts` | Pure `BrowserWindow` options builder | T1.3 |
| `src/main/windows/overlay-window.ts` | Electron glue: creates the overlay window | T1.3 |
| `src/main/windows/overlay-state.ts` | Pure overlay state reducers (immutable) | T1.4 |
| `src/main/windows/overlay-controller.ts` | Applies overlay state to a window | T1.4 |
| `src/main/windows/position.ts` | Pure window-move position math | T1.11 |
| `src/main/hotkeys/hotkey-map.ts` | Pure accelerator to action resolver | T1.5 |
| `src/main/hotkeys/global-hotkeys.ts` | Registers global shortcuts (injected dep) | T1.5 |
| `src/main/ipc/ipc-handlers.ts` | Registers IPC handlers (injected dep) | T1.6 |
| `src/preload/api.ts` | Builds the renderer-facing API (injected dep) | T1.6 |
| `src/preload/index.ts` | Exposes the API via contextBridge | T1.6 |
| `src/preload/index.d.ts` | Window typing for the renderer | T1.6 |
| `src/renderer/src/components/CommandBar.tsx` | Question input | T1.7 |
| `src/renderer/src/components/TranscriptPanel.tsx` | Transcript display shell | T1.8 |
| `src/renderer/src/components/AnswerPanel.tsx` | Answer display shell | T1.8 |
| `src/renderer/src/components/EyeToggle.tsx` | Invisibility toggle button | T1.9 |
| `src/renderer/src/components/SetupBanner.tsx` | Setup warning banner | T1.9 |
| `src/renderer/src/App.tsx` | Composes the UI, wires the preload API | T1.10 |
| `src/renderer/src/styles/theme.css` | Black-and-white theme | T1.10 |
| `src/main/index.ts` | Wires window, hotkeys, IPC together | T1.11 |

---

## Task T1.1: Scaffold the project

**Files:**
- Create: the electron-vite project in `/Users/chinmay_shringi/Desktop/Customcluely`
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/smoke.test.ts`

This is a setup task, verified by a passing build and a passing smoke test rather than by TDD.

- [ ] **Step 1: Scaffold electron-vite into a temp directory**

Run:
```bash
npm create @quick-start/electron@latest /tmp/customcluely-scaffold -- --template react-ts
```
If the tool prompts, accept defaults (no extra add-ons). Expected result: `/tmp/customcluely-scaffold` contains `electron.vite.config.ts`, `package.json`, `tsconfig*.json`, `electron-builder.yml`, and `src/main`, `src/preload`, `src/renderer`.

- [ ] **Step 2: Move the scaffold into the project, preserving git and the spec**

Run:
```bash
rsync -a --exclude='.git' --exclude='.gitignore' /tmp/customcluely-scaffold/ /Users/chinmay_shringi/Desktop/Customcluely/
cat /tmp/customcluely-scaffold/.gitignore >> /Users/chinmay_shringi/Desktop/Customcluely/.gitignore
sort -u /Users/chinmay_shringi/Desktop/Customcluely/.gitignore -o /Users/chinmay_shringi/Desktop/Customcluely/.gitignore
rm -rf /tmp/customcluely-scaffold
```
Expected: the project now has the scaffold files plus the pre-existing `docs/` and `.git/`.

- [ ] **Step 3: Install dependencies and test tooling**

Run:
```bash
cd /Users/chinmay_shringi/Desktop/Customcluely && npm install
npm install --save-dev vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```
Expected: install completes with no error.

- [ ] **Step 4: Add the Vitest config and setup file**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
```

Create `tests/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Verify the test runner and the build**

Run: `npm test`
Expected: 1 passed.

Run: `npm run build`
Expected: electron-vite build completes with no error.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite project with vitest"
```

---

## Task T1.2: Shared types and constants

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/main/config/constants.ts`

Setup task, verified by `npm run typecheck`.

- [ ] **Step 1: Create the shared types**

Create `src/shared/types.ts`:
```ts
export const IpcChannel = {
  ToggleInvisibility: 'overlay:toggle-invisibility',
  OverlayState: 'overlay:state',
} as const

export type HotkeyAction =
  | 'show-hide'
  | 'toggle-invisibility'
  | 'toggle-click-through'
  | 'move-up'
  | 'move-down'
  | 'move-left'
  | 'move-right'

export interface OverlayState {
  visible: boolean
  invisible: boolean
  clickThrough: boolean
}

export interface TranscriptSegment {
  id: string
  speaker: 'you' | 'them'
  text: string
}
```

- [ ] **Step 2: Create the main-process constants**

Create `src/main/config/constants.ts`:
```ts
import type { HotkeyAction } from '../../shared/types'

export const OVERLAY = {
  width: 720,
  height: 480,
  marginTop: 24,
} as const

export const MOVE_STEP_PX = 40

// Global shortcuts handled entirely in the main process. The submit,
// answer-insight, and stealth-answer hotkeys arrive in later phases, when
// the renderer has logic to consume them.
export const GLOBAL_HOTKEYS: Record<string, HotkeyAction> = {
  'CommandOrControl+\\': 'show-hide',
  'CommandOrControl+Shift+\\': 'toggle-invisibility',
  'CommandOrControl+Shift+M': 'toggle-click-through',
  'CommandOrControl+Up': 'move-up',
  'CommandOrControl+Down': 'move-down',
  'CommandOrControl+Left': 'move-left',
  'CommandOrControl+Right': 'move-right',
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/config/constants.ts
git commit -m "feat: add shared types and main-process constants"
```

---

## Task T1.3: Overlay window factory

**Files:**
- Create: `src/main/windows/overlay-window-options.ts`
- Create: `src/main/windows/overlay-window.ts`
- Test: `tests/main/windows/overlay-window-options.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/windows/overlay-window-options.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildOverlayWindowOptions } from '../../../src/main/windows/overlay-window-options'

describe('buildOverlayWindowOptions', () => {
  const opts = buildOverlayWindowOptions('/abs/preload/index.js')

  it('is transparent and frameless', () => {
    expect(opts.transparent).toBe(true)
    expect(opts.frame).toBe(false)
  })

  it('is always on top and hidden until shown', () => {
    expect(opts.alwaysOnTop).toBe(true)
    expect(opts.show).toBe(false)
  })

  it('is not resizable and skips the taskbar', () => {
    expect(opts.resizable).toBe(false)
    expect(opts.skipTaskbar).toBe(true)
  })

  it('uses the given preload path with context isolation on', () => {
    expect(opts.webPreferences?.preload).toBe('/abs/preload/index.js')
    expect(opts.webPreferences?.contextIsolation).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/windows/overlay-window-options.test.ts`
Expected: FAIL, cannot find module `overlay-window-options`.

- [ ] **Step 3: Implement the options builder**

Create `src/main/windows/overlay-window-options.ts`:
```ts
import type { BrowserWindowConstructorOptions } from 'electron'
import { OVERLAY } from '../config/constants'

export function buildOverlayWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: OVERLAY.width,
    height: OVERLAY.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/windows/overlay-window-options.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Implement the window factory glue**

Create `src/main/windows/overlay-window.ts`:
```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { OVERLAY } from '../config/constants'
import { buildOverlayWindowOptions } from './overlay-window-options'

export function createOverlayWindow(): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.js')
  const win = new BrowserWindow(buildOverlayWindowOptions(preloadPath))
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
  win.setPosition(Math.round((screenWidth - OVERLAY.width) / 2), OVERLAY.marginTop)
  return win
}
```

- [ ] **Step 6: Verify the build**

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/windows/overlay-window-options.ts src/main/windows/overlay-window.ts tests/main/windows/overlay-window-options.test.ts
git commit -m "feat: add overlay window factory"
```

---

## Task T1.4: Content-protection (invisibility) controller

**Files:**
- Create: `src/main/windows/overlay-state.ts`
- Create: `src/main/windows/overlay-controller.ts`
- Test: `tests/main/windows/overlay-state.test.ts`
- Test: `tests/main/windows/overlay-controller.test.ts`

- [ ] **Step 1: Write the failing test for the state reducers**

Create `tests/main/windows/overlay-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  createOverlayState,
  toggleInvisible,
  toggleClickThrough,
  setVisible,
} from '../../../src/main/windows/overlay-state'

describe('overlay-state', () => {
  it('starts visible, not invisible, not click-through', () => {
    expect(createOverlayState()).toEqual({
      visible: false,
      invisible: false,
      clickThrough: false,
    })
  })

  it('toggleInvisible returns a new object with invisible flipped', () => {
    const a = createOverlayState()
    const b = toggleInvisible(a)
    expect(b.invisible).toBe(true)
    expect(b).not.toBe(a)
    expect(a.invisible).toBe(false)
  })

  it('toggleClickThrough flips clickThrough immutably', () => {
    const b = toggleClickThrough(createOverlayState())
    expect(b.clickThrough).toBe(true)
  })

  it('setVisible sets the visible flag immutably', () => {
    const a = createOverlayState()
    const b = setVisible(a, true)
    expect(b.visible).toBe(true)
    expect(b).not.toBe(a)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/windows/overlay-state.test.ts`
Expected: FAIL, cannot find module `overlay-state`.

- [ ] **Step 3: Implement the state reducers**

Create `src/main/windows/overlay-state.ts`:
```ts
import type { OverlayState } from '../../shared/types'

export function createOverlayState(): OverlayState {
  return { visible: false, invisible: false, clickThrough: false }
}

export function toggleInvisible(state: OverlayState): OverlayState {
  return { ...state, invisible: !state.invisible }
}

export function toggleClickThrough(state: OverlayState): OverlayState {
  return { ...state, clickThrough: !state.clickThrough }
}

export function setVisible(state: OverlayState, visible: boolean): OverlayState {
  return { ...state, visible }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/windows/overlay-state.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write the failing test for the controller**

Create `tests/main/windows/overlay-controller.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { applyOverlayState } from '../../../src/main/windows/overlay-controller'

function fakeWindow() {
  return {
    setContentProtection: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
  }
}

describe('applyOverlayState', () => {
  it('enables content protection when invisible is true', () => {
    const win = fakeWindow()
    applyOverlayState(win, { visible: true, invisible: true, clickThrough: false })
    expect(win.setContentProtection).toHaveBeenCalledWith(true)
  })

  it('forwards mouse events when click-through is true', () => {
    const win = fakeWindow()
    applyOverlayState(win, { visible: true, invisible: false, clickThrough: true })
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('shows the window when visible and hides it when not', () => {
    const shown = fakeWindow()
    applyOverlayState(shown, { visible: true, invisible: false, clickThrough: false })
    expect(shown.show).toHaveBeenCalled()

    const hidden = fakeWindow()
    applyOverlayState(hidden, { visible: false, invisible: false, clickThrough: false })
    expect(hidden.hide).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/main/windows/overlay-controller.test.ts`
Expected: FAIL, cannot find module `overlay-controller`.

- [ ] **Step 7: Implement the controller**

Create `src/main/windows/overlay-controller.ts`:
```ts
import type { OverlayState } from '../../shared/types'

export interface OverlayWindowLike {
  setContentProtection(enabled: boolean): void
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void
  show(): void
  hide(): void
}

export function applyOverlayState(win: OverlayWindowLike, state: OverlayState): void {
  win.setContentProtection(state.invisible)
  win.setIgnoreMouseEvents(state.clickThrough, { forward: true })
  if (state.visible) {
    win.show()
  } else {
    win.hide()
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/main/windows/overlay-controller.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add src/main/windows/overlay-state.ts src/main/windows/overlay-controller.ts tests/main/windows/overlay-state.test.ts tests/main/windows/overlay-controller.test.ts
git commit -m "feat: add overlay state reducers and content-protection controller"
```

---

## Task T1.5: Global hotkey registry

**Files:**
- Create: `src/main/hotkeys/hotkey-map.ts`
- Create: `src/main/hotkeys/global-hotkeys.ts`
- Test: `tests/main/hotkeys/hotkey-map.test.ts`
- Test: `tests/main/hotkeys/global-hotkeys.test.ts`

- [ ] **Step 1: Write the failing test for the resolver**

Create `tests/main/hotkeys/hotkey-map.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveHotkeyAction } from '../../../src/main/hotkeys/hotkey-map'

describe('resolveHotkeyAction', () => {
  it('resolves a known accelerator to its action', () => {
    expect(resolveHotkeyAction('CommandOrControl+Shift+\\')).toBe('toggle-invisibility')
  })

  it('returns undefined for an unknown accelerator', () => {
    expect(resolveHotkeyAction('CommandOrControl+J')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/hotkeys/hotkey-map.test.ts`
Expected: FAIL, cannot find module `hotkey-map`.

- [ ] **Step 3: Implement the resolver**

Create `src/main/hotkeys/hotkey-map.ts`:
```ts
import type { HotkeyAction } from '../../shared/types'
import { GLOBAL_HOTKEYS } from '../config/constants'

export function resolveHotkeyAction(accelerator: string): HotkeyAction | undefined {
  return GLOBAL_HOTKEYS[accelerator]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/hotkeys/hotkey-map.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Write the failing test for the registrar**

Create `tests/main/hotkeys/global-hotkeys.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { registerGlobalHotkeys } from '../../../src/main/hotkeys/global-hotkeys'

describe('registerGlobalHotkeys', () => {
  it('registers every global hotkey', () => {
    const globalShortcut = { register: vi.fn(), unregisterAll: vi.fn() }
    registerGlobalHotkeys(globalShortcut, vi.fn())
    expect(globalShortcut.register).toHaveBeenCalledWith(
      'CommandOrControl+Shift+\\',
      expect.any(Function),
    )
  })

  it('invokes onAction with the resolved action when a shortcut fires', () => {
    const handlers: Record<string, () => void> = {}
    const globalShortcut = {
      register: vi.fn((accel: string, cb: () => void) => {
        handlers[accel] = cb
      }),
      unregisterAll: vi.fn(),
    }
    const onAction = vi.fn()
    registerGlobalHotkeys(globalShortcut, onAction)
    handlers['CommandOrControl+Shift+\\']()
    expect(onAction).toHaveBeenCalledWith('toggle-invisibility')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/main/hotkeys/global-hotkeys.test.ts`
Expected: FAIL, cannot find module `global-hotkeys`.

- [ ] **Step 7: Implement the registrar**

Create `src/main/hotkeys/global-hotkeys.ts`:
```ts
import type { HotkeyAction } from '../../shared/types'
import { GLOBAL_HOTKEYS } from '../config/constants'

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregisterAll(): void
}

export function registerGlobalHotkeys(
  globalShortcut: GlobalShortcutLike,
  onAction: (action: HotkeyAction) => void,
): void {
  for (const [accelerator, action] of Object.entries(GLOBAL_HOTKEYS)) {
    globalShortcut.register(accelerator, () => onAction(action))
  }
}

export function unregisterGlobalHotkeys(globalShortcut: GlobalShortcutLike): void {
  globalShortcut.unregisterAll()
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/main/hotkeys/global-hotkeys.test.ts`
Expected: 2 passed.

- [ ] **Step 9: Commit**

```bash
git add src/main/hotkeys/ tests/main/hotkeys/
git commit -m "feat: add global hotkey registry"
```

---

## Task T1.6: IPC bridge

**Files:**
- Create: `src/preload/api.ts`
- Modify: `src/preload/index.ts` (replace scaffold contents)
- Modify: `src/preload/index.d.ts` (replace scaffold contents)
- Create: `src/main/ipc/ipc-handlers.ts`
- Test: `tests/preload/api.test.ts`
- Test: `tests/main/ipc/ipc-handlers.test.ts`

- [ ] **Step 1: Write the failing test for the preload API**

Create `tests/preload/api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createOverlayApi } from '../../src/preload/api'
import { IpcChannel } from '../../src/shared/types'

describe('createOverlayApi', () => {
  it('sends toggle-invisibility on the right channel', () => {
    const ipcRenderer = { send: vi.fn(), on: vi.fn() }
    createOverlayApi(ipcRenderer).toggleInvisibility()
    expect(ipcRenderer.send).toHaveBeenCalledWith(IpcChannel.ToggleInvisibility)
  })

  it('subscribes to overlay state and returns an unsubscribe function', () => {
    const listeners: Array<(...a: unknown[]) => void> = []
    const ipcRenderer = {
      send: vi.fn(),
      on: vi.fn((_c: string, l: (...a: unknown[]) => void) => listeners.push(l)),
      removeListener: vi.fn(),
    }
    const cb = vi.fn()
    const unsub = createOverlayApi(ipcRenderer).onOverlayState(cb)
    listeners[0]({}, { visible: true, invisible: true, clickThrough: false })
    expect(cb).toHaveBeenCalledWith({ visible: true, invisible: true, clickThrough: false })
    unsub()
    expect(ipcRenderer.removeListener).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/preload/api.test.ts`
Expected: FAIL, cannot find module `api`.

- [ ] **Step 3: Implement the preload API factory**

Create `src/preload/api.ts`:
```ts
import { IpcChannel, type OverlayState } from '../shared/types'

export interface IpcRendererLike {
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: unknown[]) => void): void
  removeListener?(channel: string, listener: (...args: unknown[]) => void): void
}

export interface OverlayApi {
  toggleInvisibility(): void
  onOverlayState(callback: (state: OverlayState) => void): () => void
}

export function createOverlayApi(ipcRenderer: IpcRendererLike): OverlayApi {
  function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
    const listener = (_event: unknown, payload: T): void => callback(payload)
    ipcRenderer.on(channel, listener as (...args: unknown[]) => void)
    return () => ipcRenderer.removeListener?.(channel, listener as (...args: unknown[]) => void)
  }
  return {
    toggleInvisibility: () => ipcRenderer.send(IpcChannel.ToggleInvisibility),
    onOverlayState: (callback) => subscribe(IpcChannel.OverlayState, callback),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/preload/api.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Wire the preload entry point**

Replace the contents of `src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { createOverlayApi } from './api'

const api = createOverlayApi(ipcRenderer)

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('customcluely', api)
} else {
  // @ts-ignore fallback when context isolation is disabled
  window.customcluely = api
}
```

Replace the contents of `src/preload/index.d.ts`:
```ts
import type { OverlayApi } from './api'

declare global {
  interface Window {
    customcluely: OverlayApi
  }
}
```

- [ ] **Step 6: Write the failing test for the main IPC handlers**

Create `tests/main/ipc/ipc-handlers.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const handlers: Record<string, () => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: () => void) => {
        handlers[c] = l
      }),
    }
    const deps = { onToggleInvisibility: vi.fn() }
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/main/ipc/ipc-handlers.test.ts`
Expected: FAIL, cannot find module `ipc-handlers`.

- [ ] **Step 8: Implement the main IPC handlers**

Create `src/main/ipc/ipc-handlers.ts`:
```ts
import { IpcChannel } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/main/ipc/ipc-handlers.test.ts`
Expected: 1 passed.

- [ ] **Step 10: Commit**

```bash
git add src/preload/ src/main/ipc/ tests/preload/ tests/main/ipc/
git commit -m "feat: add IPC bridge between main and renderer"
```

---

## Task T1.7: CommandBar component

**Files:**
- Create: `src/renderer/src/components/CommandBar.tsx`
- Test: `tests/renderer/components/CommandBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/CommandBar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../../../src/renderer/src/components/CommandBar'

describe('CommandBar', () => {
  it('submits trimmed text when the Ask button is clicked', async () => {
    const onSubmit = vi.fn()
    render(<CommandBar onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Question input'), '  hello  ')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(onSubmit).toHaveBeenCalledWith('hello')
  })

  it('does not submit when the input is empty', async () => {
    const onSubmit = vi.fn()
    render(<CommandBar onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears the input after a submit', async () => {
    render(<CommandBar onSubmit={vi.fn()} />)
    const input = screen.getByLabelText('Question input') as HTMLInputElement
    await userEvent.type(input, 'question')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(input.value).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/CommandBar.test.tsx`
Expected: FAIL, cannot find module `CommandBar`.

- [ ] **Step 3: Implement the component**

Create `src/renderer/src/components/CommandBar.tsx`:
```tsx
import { useState, type KeyboardEvent } from 'react'

interface CommandBarProps {
  onSubmit: (question: string) => void
  disabled?: boolean
}

export function CommandBar({ onSubmit, disabled = false }: CommandBarProps): JSX.Element {
  const [value, setValue] = useState('')

  function submit(): void {
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    onSubmit(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="command-bar">
      <input
        className="command-bar__input"
        placeholder="Ask anything..."
        aria-label="Question input"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        className="command-bar__submit"
        onClick={submit}
        disabled={disabled}
      >
        Ask
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/CommandBar.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CommandBar.tsx tests/renderer/components/CommandBar.test.tsx
git commit -m "feat: add CommandBar component"
```

---

## Task T1.8: Transcript and Answer panels

**Files:**
- Create: `src/renderer/src/components/TranscriptPanel.tsx`
- Create: `src/renderer/src/components/AnswerPanel.tsx`
- Test: `tests/renderer/components/TranscriptPanel.test.tsx`
- Test: `tests/renderer/components/AnswerPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/components/TranscriptPanel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptPanel } from '../../../src/renderer/src/components/TranscriptPanel'

describe('TranscriptPanel', () => {
  it('shows an empty state when there are no segments', () => {
    render(<TranscriptPanel segments={[]} />)
    expect(screen.getByText('No transcript yet')).toBeInTheDocument()
  })

  it('renders each segment with its speaker label', () => {
    render(
      <TranscriptPanel
        segments={[{ id: '1', speaker: 'them', text: 'hello there' }]}
      />,
    )
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.getByText('them')).toBeInTheDocument()
  })
})
```

Create `tests/renderer/components/AnswerPanel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnswerPanel } from '../../../src/renderer/src/components/AnswerPanel'

describe('AnswerPanel', () => {
  it('shows an empty state when the answer is blank', () => {
    render(<AnswerPanel answer="" />)
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('renders the answer text when present', () => {
    render(<AnswerPanel answer="the answer" />)
    expect(screen.getByText('the answer')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/components/TranscriptPanel.test.tsx tests/renderer/components/AnswerPanel.test.tsx`
Expected: FAIL, cannot find the modules.

- [ ] **Step 3: Implement the panels**

Create `src/renderer/src/components/TranscriptPanel.tsx`:
```tsx
import type { TranscriptSegment } from '../../../shared/types'

interface TranscriptPanelProps {
  segments: TranscriptSegment[]
}

export function TranscriptPanel({ segments }: TranscriptPanelProps): JSX.Element {
  return (
    <div className="transcript-panel">
      {segments.length === 0 ? (
        <p className="panel__empty">No transcript yet</p>
      ) : (
        segments.map((segment) => (
          <p key={segment.id} className="transcript-panel__line">
            <span className="transcript-panel__speaker">{segment.speaker}</span>
            <span className="transcript-panel__text">{segment.text}</span>
          </p>
        ))
      )}
    </div>
  )
}
```

Create `src/renderer/src/components/AnswerPanel.tsx`:
```tsx
interface AnswerPanelProps {
  answer: string
}

export function AnswerPanel({ answer }: AnswerPanelProps): JSX.Element {
  return (
    <div className="answer-panel">
      {answer.trim().length === 0 ? (
        <p className="panel__empty">No answer yet</p>
      ) : (
        <p className="answer-panel__text">{answer}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/components/TranscriptPanel.test.tsx tests/renderer/components/AnswerPanel.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TranscriptPanel.tsx src/renderer/src/components/AnswerPanel.tsx tests/renderer/components/TranscriptPanel.test.tsx tests/renderer/components/AnswerPanel.test.tsx
git commit -m "feat: add transcript and answer panels"
```

---

## Task T1.9: EyeToggle and SetupBanner components

**Files:**
- Create: `src/renderer/src/components/EyeToggle.tsx`
- Create: `src/renderer/src/components/SetupBanner.tsx`
- Test: `tests/renderer/components/EyeToggle.test.tsx`
- Test: `tests/renderer/components/SetupBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/components/EyeToggle.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EyeToggle } from '../../../src/renderer/src/components/EyeToggle'

describe('EyeToggle', () => {
  it('labels itself by the current invisibility state', () => {
    render(<EyeToggle invisible={true} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Invisible: on' })).toBeInTheDocument()
  })

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn()
    render(<EyeToggle invisible={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: 'Invisible: off' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
```

Create `tests/renderer/components/SetupBanner.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SetupBanner } from '../../../src/renderer/src/components/SetupBanner'

describe('SetupBanner', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<SetupBanner message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the message when present', () => {
    render(<SetupBanner message="Run codex login" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Run codex login')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/components/EyeToggle.test.tsx tests/renderer/components/SetupBanner.test.tsx`
Expected: FAIL, cannot find the modules.

- [ ] **Step 3: Implement the components**

Create `src/renderer/src/components/EyeToggle.tsx`:
```tsx
interface EyeToggleProps {
  invisible: boolean
  onToggle: () => void
}

export function EyeToggle({ invisible, onToggle }: EyeToggleProps): JSX.Element {
  return (
    <button
      className="eye-toggle"
      aria-label={`Invisible: ${invisible ? 'on' : 'off'}`}
      onClick={onToggle}
    >
      {invisible ? 'Eye off' : 'Eye'}
    </button>
  )
}
```

Create `src/renderer/src/components/SetupBanner.tsx`:
```tsx
interface SetupBannerProps {
  message: string | null
}

export function SetupBanner({ message }: SetupBannerProps): JSX.Element | null {
  if (message === null) return null
  return (
    <div className="setup-banner" role="alert">
      {message}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/components/EyeToggle.test.tsx tests/renderer/components/SetupBanner.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/EyeToggle.tsx src/renderer/src/components/SetupBanner.tsx tests/renderer/components/EyeToggle.test.tsx tests/renderer/components/SetupBanner.test.tsx
git commit -m "feat: add EyeToggle and SetupBanner components"
```

---

## Task T1.10: App composition and theme

**Files:**
- Modify: `src/renderer/src/App.tsx` (replace scaffold contents)
- Create: `src/renderer/src/styles/theme.css`
- Test: `tests/renderer/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'

beforeEach(() => {
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
  }
})

describe('App', () => {
  it('renders the command bar and both panels', () => {
    render(<App />)
    expect(screen.getByLabelText('Question input')).toBeInTheDocument()
    expect(screen.getByText('No transcript yet')).toBeInTheDocument()
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('calls the preload toggleInvisibility when the eye toggle is clicked', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Invisible: off' }))
    expect(window.customcluely.toggleInvisibility).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/App.test.tsx`
Expected: FAIL, the scaffold `App` does not export `App` or render these elements.

- [ ] **Step 3: Implement the App composition**

Replace the contents of `src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { SetupBanner } from './components/SetupBanner'
import type { OverlayState, TranscriptSegment } from '../../shared/types'
import './styles/theme.css'

export function App(): JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [activeQuestion, setActiveQuestion] = useState('')
  const [segments] = useState<TranscriptSegment[]>([])

  useEffect(() => {
    const unsubscribe = window.customcluely.onOverlayState((state: OverlayState) => {
      setInvisible(state.invisible)
    })
    return unsubscribe
  }, [])

  return (
    <div className="app">
      <SetupBanner message={null} />
      <div className="app__bar">
        <CommandBar onSubmit={setActiveQuestion} />
        <EyeToggle invisible={invisible} onToggle={() => window.customcluely.toggleInvisibility()} />
      </div>
      {activeQuestion.length > 0 && (
        <p className="app__active-question">{activeQuestion}</p>
      )}
      <AnswerPanel answer="" />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
```

- [ ] **Step 4: Create the black-and-white theme**

Create `src/renderer/src/styles/theme.css`:
```css
:root {
  color-scheme: dark;
}

body {
  margin: 0;
  background: transparent;
  font-family: -apple-system, system-ui, sans-serif;
}

.app {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  color: #f5f5f5;
  background: rgba(10, 10, 10, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
}

.app__bar {
  display: flex;
  gap: 8px;
  align-items: center;
}

.command-bar {
  display: flex;
  flex: 1;
  gap: 6px;
}

.command-bar__input {
  flex: 1;
  padding: 8px 10px;
  color: #f5f5f5;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
}

.command-bar__submit,
.eye-toggle {
  padding: 8px 12px;
  color: #0a0a0a;
  background: #f5f5f5;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.panel__empty {
  color: rgba(245, 245, 245, 0.45);
  font-size: 13px;
}

.transcript-panel__speaker {
  margin-right: 6px;
  color: rgba(245, 245, 245, 0.55);
  text-transform: uppercase;
  font-size: 11px;
}

.setup-banner {
  padding: 6px 10px;
  background: #f5f5f5;
  color: #0a0a0a;
  border-radius: 8px;
  font-size: 13px;
}
```

- [ ] **Step 5: Ensure the renderer entry point renders the named export**

Open `src/renderer/src/main.tsx`. Confirm it imports and renders `App`. If it uses a default import, leave it; the App file exports both named and default. No change needed unless the import path is broken.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/App.test.tsx`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/styles/theme.css tests/renderer/App.test.tsx
git commit -m "feat: compose overlay UI with black-and-white theme"
```

---

## Task T1.11: Wire hotkeys and IPC end to end

**Files:**
- Create: `src/main/windows/position.ts`
- Modify: `src/main/index.ts` (replace scaffold contents)
- Test: `tests/main/windows/position.test.ts`

- [ ] **Step 1: Write the failing test for the position math**

Create `tests/main/windows/position.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { nextPosition } from '../../../src/main/windows/position'

describe('nextPosition', () => {
  it('moves up by the step', () => {
    expect(nextPosition([100, 200], 'move-up', 40)).toEqual([100, 160])
  })

  it('moves right by the step', () => {
    expect(nextPosition([100, 200], 'move-right', 40)).toEqual([140, 200])
  })

  it('returns the same coordinates for a non-move action', () => {
    expect(nextPosition([100, 200], 'show-hide', 40)).toEqual([100, 200])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/windows/position.test.ts`
Expected: FAIL, cannot find module `position`.

- [ ] **Step 3: Implement the position math**

Create `src/main/windows/position.ts`:
```ts
import type { HotkeyAction } from '../../shared/types'

export function nextPosition(
  current: [number, number],
  action: HotkeyAction,
  step: number,
): [number, number] {
  const [x, y] = current
  switch (action) {
    case 'move-up':
      return [x, y - step]
    case 'move-down':
      return [x, y + step]
    case 'move-left':
      return [x - step, y]
    case 'move-right':
      return [x + step, y]
    default:
      return [x, y]
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/windows/position.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Wire everything in the main entry point**

Replace the contents of `src/main/index.ts`:
```ts
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createOverlayWindow } from './windows/overlay-window'
import {
  createOverlayState,
  toggleInvisible,
  toggleClickThrough,
  setVisible,
} from './windows/overlay-state'
import { applyOverlayState } from './windows/overlay-controller'
import { nextPosition } from './windows/position'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys/global-hotkeys'
import { registerIpcHandlers } from './ipc/ipc-handlers'
import { MOVE_STEP_PX } from './config/constants'
import { IpcChannel, type HotkeyAction } from '../shared/types'

let overlay: BrowserWindow | null = null
let state = createOverlayState()

function pushState(): void {
  if (!overlay) return
  applyOverlayState(overlay, state)
  overlay.webContents.send(IpcChannel.OverlayState, state)
}

function handleHotkey(action: HotkeyAction): void {
  if (!overlay) return
  switch (action) {
    case 'show-hide':
      state = setVisible(state, !state.visible)
      break
    case 'toggle-invisibility':
      state = toggleInvisible(state)
      break
    case 'toggle-click-through':
      state = toggleClickThrough(state)
      break
    case 'move-up':
    case 'move-down':
    case 'move-left':
    case 'move-right': {
      const pos = overlay.getPosition() as [number, number]
      const [x, y] = nextPosition(pos, action, MOVE_STEP_PX)
      overlay.setPosition(x, y)
      return
    }
  }
  pushState()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.customcluely.app')
  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  overlay = createOverlayWindow()
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  state = setVisible(state, true)
  overlay.on('ready-to-show', () => pushState())

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
  })

  registerGlobalHotkeys(globalShortcut, handleHotkey)
})

app.on('will-quit', () => unregisterGlobalHotkeys(globalShortcut))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Verify the full build and the test suite**

Run: `npm run typecheck`
Expected: no type errors.

Run: `npm test`
Expected: every test passes (smoke plus all Phase 1 tests).

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 7: Commit**

```bash
git add src/main/windows/position.ts src/main/index.ts tests/main/windows/position.test.ts
git commit -m "feat: wire overlay window, hotkeys, and IPC together"
```

---

## Task T1.12: Phase 1 verification

**Files:** none. This task runs the real app and records observed behavior.

This is a manual verification task. The orchestrator (or a verification agent using the `verify` skill) performs it.

- [ ] **Step 1: Launch the app**

Run: `npm run dev`
Expected: a transparent, frameless overlay appears near the top center of the screen, showing the command bar, the eye toggle, and the two empty panels.

- [ ] **Step 2: Verify show and hide**

Press `Cmd+\`.
Expected: the overlay hides. Press again: it reappears.

- [ ] **Step 3: Verify the invisibility toggle**

Press `Cmd+Shift+\` (or click the eye toggle).
Expected: the eye toggle label flips between "Invisible: on" and "Invisible: off".

- [ ] **Step 4: Verify content protection against screen capture**

Start a macOS screen recording (QuickTime Player, or `Cmd+Shift+5`). With invisibility ON, the overlay must NOT appear in the recording. With invisibility OFF, it must appear.
Expected: recording confirms the overlay is excluded from capture only when invisibility is ON.

- [ ] **Step 5: Verify text input**

Type a question in the command bar and press `Cmd+Return`.
Expected: the input clears and the typed question appears as the active question line. No answer is produced yet; Codex integration is Phase 2.

- [ ] **Step 6: Record the results**

Write the observed results into `docs/superpowers/verification/2026-05-20-phase-1.md`, including a note on the screen-recording check. If any step fails, file the failure as a new task and do not mark Phase 1 complete.

- [ ] **Step 7: Commit the verification record**

```bash
git add docs/superpowers/verification/2026-05-20-phase-1.md
git commit -m "docs: record Phase 1 verification results"
```

---

## Phase 1 done criteria

- Every task above is committed.
- `npm test` passes with all Phase 1 tests green.
- `npm run typecheck` and `npm run build` succeed.
- The Phase 1 verification record confirms the overlay appears, hotkeys work, and `setContentProtection` hides the overlay from a screen recording when invisibility is ON.
