# Phase 5: Context Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the roadmap, every task runs through the 3-agent pipeline (implementer, auditor, documenter).

**Goal:** Deliver the full Cluely Live Insights experience on top of Phases 1 to 4: a rolling transcript summarizer that keeps the Codex prompt bounded as a meeting runs long, a screenshot-context attachment path so a query can carry the screen, a row of Default Actions (preset prompts), a dynamic insight detector that surfaces questions and keywords from the transcript, and an explicit session manager so insights show only during an active meeting. The acceptance check is a full meeting flow: start a session, listen, have a question detected, and answer it using the rolling transcript plus an optional screenshot.

**Architecture:** All Phase 5 logic lives in pure, dependency-injected, deterministic modules so it is fully unit-testable; the renderer wiring is a thin layer on top. The rolling transcript summarizer (`transcript-context.ts`) is a pure module that takes the full segment list and a character budget and returns a bounded context string: recent segments verbatim plus a char-budgeted compaction of older segments, with no extra Codex call. The Codex path is extended through a single new entry point on `CodexService` (`handleContextAsk`) that accepts a question, the transcript segments, an optional screenshot file path, and optional extra codex args; `prompt-builder` gains a transcript-aware builder and `codex-args` gains an `imagePath` plus an `extraArgs` field. Default Actions are five entries in a pure `default-actions.ts` table (id, label, prompt template, codex-arg modifiers); "Fact check" adds `--search`. The dynamic insight detector (`insight-detector.ts`) is a pure rule-based scanner: it flags transcript segments that are questions (interrogative opener or `?` ending) or carry salient keywords, and returns a ranked, de-duplicated insight list. The session manager (`session-manager.ts`) is a pure state machine wrapping start/stop; the renderer's existing `ListenToggle` is repurposed as the session start/stop control, and insight detection plus the insight surface are gated on an active session. Screenshots requested from the Phase 4 sidecar are written to the Codex scratch directory as PNG files and attached to the next query via `-i`.

**Tech Stack:** Electron 39, TypeScript (no semicolons, single quotes, 2-space indent, prettier `trailingComma: none`), React 19 (`React.JSX.Element`), electron-vite, codex CLI 0.125.0, Vitest 4 (no globals, node default environment, jsdom for renderer tests with the literal `// @vitest-environment jsdom` as the first line).

---

## Pinned research facts (do not re-research)

Verified on 2026-05-22. Treat as fixed inputs.

1. **Codex `-i` image attachment.** Codex CLI 0.125.0 `codex exec` accepts `-i <path>` (also `--image <path>`) to attach an image file to the prompt; multiple `-i` flags attach multiple images. The design spec (sections 7 and 8.4) writes it as `codex exec --json [--image shot.png] ...` and `[-i <screenshot.png>]`. This plan uses `-i` and attaches at most one screenshot per query. The screenshot must be a real file on disk before the query runs, so the PNG is written to the Codex scratch directory first.

2. **Codex `--search` flag.** `codex exec --search` enables Codex's web-search tool for that turn. The design spec (section 8.4) says `--search` is "added only for the Fact check Default Action." Phase 5 honors that: only the `fact-check` Default Action contributes `--search` to the codex args.

3. **Phase 4 screenshot path already exists.** Phase 4 built the full sidecar screenshot capture and delivery: `SidecarSupervisor.requestScreenshot()` sends a `{ type: 'screenshot' }` command, and the sidecar replies with a `screenshot` event that the supervisor turns into a `ScreenshotPayload` (`{ format: 'png', dataBase64: string }`) delivered to the `onScreenshot` callback, which `index.ts` forwards on `IpcChannel.Screenshot`. Phase 4 deliberately left this without a UI trigger; Phase 5 T5.2 adds the trigger and the attach-to-query path. No new sidecar or supervisor code is needed for screenshots.

4. **Codex scratch directory.** `index.ts` already builds `scratchRoot = join(app.getPath('userData'), CODEX.scratchDirName)` and passes it to `createCodexService`. `CodexService` writes per-query answer files there. Phase 5 writes screenshot PNGs into the same scratch root (a `screenshots/` subdir) so they sit beside the answer files, are cleaned up the same way, and never pollute the repo. The decision is recorded below.

5. **`exec resume --last` and `--output-schema` are deferred.** The spec (section 8.4) lists `exec resume --last` for cross-question context and `--output-schema` for structured Default Actions, but section 9 explicitly defers conversation-context optimization to "a later optimization, not part of v1." Phase 5 keeps the v1 `codex exec` per-query model. Cross-question context is provided instead by the rolling transcript summary (every query carries the bounded transcript), which is simpler, deterministic, and testable. `--output-schema` is not used: Default Actions ask for plain-text answers like every other query.

6. **`Tab` hotkey is renderer-local.** The spec hotkey table (section 13) lists `Tab` for "answer first dynamic insight." `Tab` is a normal key inside a focused web page, not a macOS global shortcut, and the `GLOBAL_HOTKEYS` map in `constants.ts` deliberately omits the submit, answer-insight, and stealth hotkeys (its comment says they "arrive in later phases, when the renderer has logic to consume them"). Phase 5 implements `Tab` as a renderer-level `keydown` handler in `App.tsx`, guarded so it does not steal `Tab` while a text input is focused. No `globalShortcut` change is made.

7. **Screenshot hotkey.** The spec hotkey table does not assign a screenshot hotkey. T5.2 needs a hotkey for the screenshot trigger; this plan adds `Cmd+Shift+S` as a renderer-level `keydown` handler in `App.tsx` (consistent with the `Tab` decision: renderer-local, not a global shortcut), alongside a visible screenshot button. The decision is recorded below.

## Decisions recorded (the spec's deferred open items and Phase 5 design choices)

- **Summarizer approach: pure heuristic compaction, no extra Codex call.** The rolling transcript summarizer is a pure, deterministic module (`transcript-context.ts`). It keeps the most recent N segments verbatim and compacts everything older into a single char-budgeted digest (a truncated, speaker-prefixed join with a leading `[earlier in the meeting]` marker). It makes NO background `codex` call. Rationale: a background summarization call adds latency, cost, non-determinism, and a second Codex process to supervise, for a meeting-assistant whose entire value is speed. A deterministic char budget is instant, free, fully unit-testable, and good enough to keep the prompt bounded. A model-based summarizer can be a later optimization; v1 is heuristic. The `prompt-builder` consumes the bounded result.

- **Session manager reconciles with `ListenToggle` by wrapping it, not replacing it.** Phase 3/4 already ship a `ListenToggle` button and a `useTranscript` hook whose `startListening`/`stopListening` start and stop sidecar capture. Phase 5 does NOT add a second button or a competing hook. Instead, a new pure `session-manager.ts` state machine models the meeting session (`idle` to `active` to `ended`), and a new `useSession` hook composes `useTranscript`: starting a session calls `useTranscript.startListening` (which already starts capture and clears the main-process transcript) AND enables insight detection; stopping a session calls `useTranscript.stopListening` AND freezes insight detection. `ListenToggle` keeps its existing props (`listening`, `onToggle`) and its existing place in the command bar; `App.tsx` simply feeds it `session.active` and `session.toggle`. The button label still reads "Start listening"/"Stop listening" because that is the user-facing verb for a session. So: the session manager SUPERSEDES the bare listen toggle conceptually (a session is the unit of meaning) while REUSING the `ListenToggle` component and the `useTranscript` capture plumbing unchanged.

- **Insight detection heuristic: pure rule-based, no model.** `insight-detector.ts` scans each transcript segment with deterministic rules: (a) a segment is a QUESTION if its trimmed text ends with `?`, or its first word is an interrogative (`who`, `what`, `when`, `where`, `why`, `how`, `which`, `whose`, `can`, `could`, `should`, `would`, `do`, `does`, `did`, `is`, `are`, `will`); (b) a segment yields a KEYWORD insight if it contains a salient term from a small curated list (for example `deadline`, `budget`, `risk`, `blocker`, `decision`, `action item`, `next step`, `timeline`, `owner`, `priority`). Each detected insight carries an id, a kind (`question` | `keyword`), the source segment id, and a short prompt-ready label. Insights are de-duplicated by normalized text and ranked questions-first then by recency. The detector is a pure function over the segment list, fully unit-testable, no network, no model. This resolves the spec's section 20 open item ("rule-based vs a lightweight model") in favor of rule-based for v1.

- **Screenshot PNG location.** Screenshots delivered by the sidecar are decoded from base64 and written to `<userData>/.codex-scratch/screenshots/shot-<uuid>.png`. They live beside the Codex answer files and are attached to the next query via `-i`. The screenshot store's `consume()` only returns the pending path and clears the pending slot; it does not touch the file. The Codex runner (`codex-service.ts` `runQuery`) deletes the screenshot file in its `finally` block once the query completes, exactly as it removes the answer file, so the PNG survives long enough for `codex` to read it. Only the single most recent screenshot is held as "pending" at a time; requesting another replaces it.

- **Tab and screenshot hotkeys are renderer-local.** Per pinned facts 6 and 7, `Tab` (answer first insight) and `Cmd+Shift+S` (capture screenshot) are handled by a `keydown` listener in `App.tsx`, not by `globalShortcut`. `Tab` is ignored while a text input or textarea is focused so normal typing/focus traversal still works.

- **Default Action while a question is in flight.** `CodexService` already enforces a single-flight guard (`inFlight`); a Default Action or insight answer that arrives mid-query is rejected with the existing `AnswerError` "A question is already being processed" message. No new concurrency code is added.

## Typecheck-red window

Phase 5 has a small, intentional typecheck-red window in Task 4. `codex-args.ts` and `prompt-builder.ts` are changed in Tasks 2 and 3, but `codex-service.ts` (the only consumer of both) is not rewired until Task 4. Specifically: Task 3 changes `buildPrompt` from a one-argument function `buildPrompt(question)` to a transcript-aware signature. Until Task 4 updates `codex-service.ts` to call the new signature, `npm run typecheck` reports an error in `codex-service.ts`. This is expected and is called out explicitly in Task 3, Step 6. Tasks 2 (`codex-args` gains optional fields) and 3 are individually safe-ish, but the cross-file break is fully closed at the end of Task 4, where `npm run typecheck` must return to PASS. No other task leaves the tree red.

---

## File Structure

Every file created or modified in Phase 5, with its single responsibility.

### Modified - shared

- `src/shared/types.ts` (MODIFIED) - adds the Phase 5 IPC channels (`AskContextQuestion`, `RequestScreenshot`) and the `ContextAskRequest` and `DefaultActionId` types; keeps every Phase 1 to 4 symbol unchanged.

### Modified - main process config

- `src/main/config/constants.ts` (MODIFIED) - adds the `CONTEXT` const (recent-segment count kept verbatim, older-segment char budget, the marker text) and the `INSIGHTS` const (max surfaced insights, the salient-keyword list).

### Created - main process (`src/main/codex/`)

- `src/main/codex/transcript-context.ts` - pure rolling transcript summarizer: given the full segment list and a budget, returns a bounded context string (recent segments verbatim plus a char-budgeted digest of older segments). No Codex call.
- `src/main/codex/default-actions.ts` - the pure Default Actions table: five action definitions (id, label, prompt template, codex-arg modifiers) plus a lookup helper. Unit-testable, no I/O.

### Modified - main process (`src/main/codex/`)

- `src/main/codex/prompt-builder.ts` (MODIFIED) - `buildPrompt` becomes transcript-aware: it takes the question plus the bounded transcript context and assembles the system instruction, the transcript context, and the question.
- `src/main/codex/codex-args.ts` (MODIFIED) - `CodexArgsInput` gains optional `imagePath` (emits `-i <path>`) and `extraArgs` (appended before the prompt, for `--search`).
- `src/main/codex/codex-service.ts` (MODIFIED) - gains `handleContextAsk`, which accepts a question, transcript segments, an optional screenshot path, and optional extra args; builds the bounded context, the prompt, and the args; runs the query; cleans up the screenshot file.

### Created - main process (`src/main/insights/`)

- `src/main/insights/insight-detector.ts` - pure rule-based dynamic insight detector: scans transcript segments, flags questions and salient keywords, returns a ranked de-duplicated insight list.

### Created - main process (`src/main/session/`)

- `src/main/session/session-manager.ts` - pure session state machine: `idle` to `active` to `ended`, with immutable transitions and a guard that insights are valid only while `active`.

### Created - main process (`src/main/screenshots/`)

- `src/main/screenshots/screenshot-store.ts` - decodes a base64 PNG to a file in the Codex scratch `screenshots/` dir and tracks the single pending screenshot path. `consume()` returns the path and clears the pending slot without deleting the file; the Codex runner deletes the file after the query. Dependency-injected filesystem.

### Modified - main process

- `src/main/ipc/ipc-handlers.ts` (MODIFIED) - registers the `AskContextQuestion` and `RequestScreenshot` channels.
- `src/main/index.ts` (MODIFIED) - constructs the `ScreenshotStore`, routes sidecar `onScreenshot` into the store, wires `AskContextQuestion` to `codexService.handleContextAsk` with the pending screenshot, wires `RequestScreenshot` to `sidecar.requestScreenshot`.

### Modified - preload (`src/preload/`)

- `src/preload/api.ts` (MODIFIED) - adds `askContextQuestion` and `requestScreenshot` to `OverlayApi`.

### Created - renderer (`src/renderer/src/`)

- `src/renderer/src/components/DefaultActions.tsx` - the row of five black-and-white Default Action buttons.
- `src/renderer/src/components/InsightList.tsx` - the dynamic-insight surface shown below the command bar during an active session.
- `src/renderer/src/insights/detect-insights.ts` - a renderer-side re-export wrapper so the renderer imports the pure detector without reaching into `src/main`. (The detector logic itself is the shared pure module; this file is the thin import boundary.)
- `src/renderer/src/hooks/useInsights.ts` - React hook: runs the pure detector over the live transcript segments while a session is active, exposes the ranked insights and an `answerFirst` action.
- `src/renderer/src/hooks/useSession.ts` - React hook: composes `useTranscript`, models the session state with the pure `session-manager`, and exposes `active`, `toggle`, plus session-gated insight enabling.

### Modified - renderer

- `src/renderer/src/hooks/useCodexAnswer.ts` (MODIFIED) - gains `askContext(question, segments, options)` so a transcript-and-screenshot-aware query can be sent; the existing `ask` remains for plain questions.
- `src/renderer/src/App.tsx` (MODIFIED) - composes `useSession`, `useInsights`, and `useCodexAnswer`; renders `DefaultActions` and `InsightList`; adds the `Tab` and `Cmd+Shift+S` `keydown` handlers; feeds `ListenToggle` from the session.

### Modified - styles

- `src/renderer/src/styles/theme.css` (MODIFIED) - adds black-and-white styling for `.default-actions`, `.insight-list`, and the screenshot button.

### Created - tests (`tests/`)

- `tests/main/codex/transcript-context.test.ts`
- `tests/main/codex/default-actions.test.ts`
- `tests/main/codex/prompt-builder.test.ts` (MODIFIED) - updates for the transcript-aware signature.
- `tests/main/codex/codex-args.test.ts` (MODIFIED) - adds the `imagePath` and `extraArgs` cases.
- `tests/main/codex/codex-service.test.ts` (MODIFIED) - adds `handleContextAsk` coverage.
- `tests/main/insights/insight-detector.test.ts`
- `tests/main/session/session-manager.test.ts`
- `tests/main/screenshots/screenshot-store.test.ts`
- `tests/main/ipc/ipc-handlers.test.ts` (MODIFIED) - adds the two new channels.
- `tests/shared/types.test.ts` (MODIFIED) - adds the Phase 5 channel and constants cases.
- `tests/preload/api.test.ts` (MODIFIED) - adds `askContextQuestion`/`requestScreenshot`.
- `tests/renderer/components/DefaultActions.test.tsx`
- `tests/renderer/components/InsightList.test.tsx`
- `tests/renderer/hooks/useInsights.test.ts`
- `tests/renderer/hooks/useSession.test.ts`
- `tests/renderer/App.test.tsx` (MODIFIED) - updates the bridge mock to the Phase 5 surface and adds Default Action, insight, and session cases.

### Created - docs

- `docs/superpowers/verification/2026-05-20-phase-5.md` - the Phase 5 verification doc (automated checks plus the full end-to-end manual checklist).

---

## Task 1: CONTEXT and INSIGHTS constants and Phase 5 shared types (T5.1, T5.3, T5.4)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config/constants.ts`
- Test: `tests/shared/types.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block to `tests/shared/types.test.ts` inside the existing top-level area (keep all existing imports and cases; add a `CONTEXT, INSIGHTS` import alongside the existing imports from `'../../src/main/config/constants'`):

```typescript
import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'
import { CONTEXT, INSIGHTS } from '../../src/main/config/constants'

describe('Phase 5 IpcChannel entries', () => {
  it('defines the context-ask and screenshot-request channels', () => {
    expect(IpcChannel.AskContextQuestion).toBe('codex:ask-context')
    expect(IpcChannel.RequestScreenshot).toBe('sidecar:request-screenshot')
  })
})

describe('CONTEXT constants', () => {
  it('pins the verbatim recent-segment count and the older-segment char budget', () => {
    expect(CONTEXT.recentSegments).toBe(12)
    expect(CONTEXT.olderCharBudget).toBe(1200)
    expect(CONTEXT.olderMarker).toBe('[earlier in the meeting]')
  })
})

describe('INSIGHTS constants', () => {
  it('pins the max surfaced insight count and a non-empty keyword list', () => {
    expect(INSIGHTS.maxSurfaced).toBe(5)
    expect(Array.isArray(INSIGHTS.keywords)).toBe(true)
    expect(INSIGHTS.keywords).toContain('deadline')
    expect(INSIGHTS.keywords).toContain('action item')
    expect(INSIGHTS.keywords.length).toBeGreaterThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/shared/types.test.ts`
Expected: FAIL: `IpcChannel.AskContextQuestion` is `undefined`, and `CONTEXT`/`INSIGHTS` are not exported from constants.

- [ ] **Step 3: Add the Phase 5 channels and types to `src/shared/types.ts`**

Replace the `IpcChannel` const at the top of `src/shared/types.ts` with this version (it adds the two Phase 5 channels and keeps every existing entry):

```typescript
export const IpcChannel = {
  ToggleInvisibility: 'overlay:toggle-invisibility',
  OverlayState: 'overlay:state',
  AskQuestion: 'codex:ask',
  AskContextQuestion: 'codex:ask-context',
  AnswerChunk: 'codex:answer-chunk',
  AnswerDone: 'codex:answer-done',
  AnswerError: 'codex:answer-error',
  CodexStatus: 'codex:status',
  StartTranscription: 'transcription:start',
  StopTranscription: 'transcription:stop',
  TranscriptUpdate: 'transcription:update',
  TranscriptionStatus: 'transcription:status',
  SidecarStatus: 'sidecar:status',
  Screenshot: 'sidecar:screenshot',
  RequestScreenshot: 'sidecar:request-screenshot'
} as const
```

Then append these type definitions to the end of `src/shared/types.ts` (after the existing `ScreenshotPayload` interface, do not change anything above):

```typescript
/** The id of one Default Action preset. Matches default-actions.ts. */
export type DefaultActionId =
  | 'say-next'
  | 'follow-up'
  | 'fact-check'
  | 'recap'
  | 'coding-help'

/**
 * A transcript-and-screenshot-aware Codex query sent from the renderer. The
 * renderer passes the live transcript segments so the main process can build
 * a bounded prompt context; `screenshot` is true when the pending screenshot
 * should be attached; `extraArgs` carries Default-Action codex-arg modifiers
 * such as `--search`.
 */
export interface ContextAskRequest {
  requestId: string
  question: string
  segments: TranscriptSegment[]
  screenshot: boolean
  extraArgs: string[]
}
```

- [ ] **Step 4: Add the `CONTEXT` and `INSIGHTS` consts to `src/main/config/constants.ts`**

Append this block to the end of `src/main/config/constants.ts` (after the existing `SIDECAR` const, do not change anything above it):

```typescript
export const CONTEXT = {
  // The rolling transcript summarizer keeps this many of the most recent
  // segments verbatim so the model always sees the live thread of the
  // conversation word for word.
  recentSegments: 12,
  // Everything older than the recent window is compacted into a single
  // digest truncated to this many characters, so a long meeting cannot
  // grow the Codex prompt without bound.
  olderCharBudget: 1_200,
  // Prefix that introduces the compacted older-transcript digest.
  olderMarker: '[earlier in the meeting]'
} as const

export const INSIGHTS = {
  // The dynamic-insight surface shows at most this many insights at once.
  maxSurfaced: 5,
  // Salient terms that make a transcript segment worth surfacing as a
  // keyword insight. Lowercase; matched case-insensitively as substrings.
  keywords: [
    'deadline',
    'budget',
    'risk',
    'blocker',
    'decision',
    'action item',
    'next step',
    'timeline',
    'owner',
    'priority'
  ]
} as const
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/shared/types.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no type errors (this task only adds symbols; nothing is removed or changed in a breaking way).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/config/constants.ts tests/shared/types.test.ts
git commit -m "feat: add Phase 5 context IPC channels, types, and CONTEXT/INSIGHTS constants"
```

---

## Task 2: Codex args support for image attachment and extra flags (T5.2, T5.3)

**Files:**
- Modify: `src/main/codex/codex-args.ts`
- Test: `tests/main/codex/codex-args.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/main/codex/codex-args.test.ts` with this version (it keeps every existing case and adds the `imagePath` and `extraArgs` cases):

```typescript
import { describe, it, expect } from 'vitest'
import { buildCodexArgs } from '../../../src/main/codex/codex-args'

const base = { prompt: 'hi', outputFile: '/tmp/out.txt', workdir: '/tmp/scratch' }

describe('buildCodexArgs', () => {
  it('starts with the exec subcommand and JSON streaming', () => {
    const args = buildCodexArgs(base)
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
  })

  it('runs ephemeral, outside a git repo, read-only', () => {
    const args = buildCodexArgs(base)
    expect(args).toContain('--ephemeral')
    expect(args).toContain('--skip-git-repo-check')
    expect(args).toEqual(expect.arrayContaining(['-s', 'read-only']))
  })

  it('passes the working directory and output file', () => {
    const args = buildCodexArgs(base)
    expect(args).toEqual(expect.arrayContaining(['-C', '/tmp/scratch']))
    expect(args).toEqual(expect.arrayContaining(['-o', '/tmp/out.txt']))
  })

  it('sets low reasoning effort via a config override', () => {
    const args = buildCodexArgs(base)
    const idx = args.indexOf('-c')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe('model_reasoning_effort="low"')
  })

  it('puts the prompt last', () => {
    expect(buildCodexArgs(base).at(-1)).toBe('hi')
  })

  it('omits the model flag unless a model is given', () => {
    expect(buildCodexArgs(base)).not.toContain('-m')
    expect(buildCodexArgs({ ...base, model: 'gpt-5' })).toEqual(
      expect.arrayContaining(['-m', 'gpt-5'])
    )
  })

  it('omits the image flag unless an imagePath is given', () => {
    expect(buildCodexArgs(base)).not.toContain('-i')
  })

  it('attaches an image with -i before the prompt when imagePath is given', () => {
    const args = buildCodexArgs({ ...base, imagePath: '/tmp/scratch/shot.png' })
    expect(args).toEqual(expect.arrayContaining(['-i', '/tmp/scratch/shot.png']))
    const imageIdx = args.indexOf('-i')
    expect(imageIdx).toBeLessThan(args.length - 1)
    expect(args.at(-1)).toBe('hi')
  })

  it('appends extraArgs before the prompt', () => {
    const args = buildCodexArgs({ ...base, extraArgs: ['--search'] })
    const searchIdx = args.indexOf('--search')
    expect(searchIdx).toBeGreaterThanOrEqual(0)
    expect(searchIdx).toBeLessThan(args.length - 1)
    expect(args.at(-1)).toBe('hi')
  })

  it('ignores an empty extraArgs array', () => {
    const args = buildCodexArgs({ ...base, extraArgs: [] })
    expect(args.at(-1)).toBe('hi')
    expect(args).not.toContain('--search')
  })

  it('keeps the prompt last even with both imagePath and extraArgs', () => {
    const args = buildCodexArgs({
      ...base,
      imagePath: '/tmp/scratch/shot.png',
      extraArgs: ['--search']
    })
    expect(args.at(-1)).toBe('hi')
    expect(args).toEqual(expect.arrayContaining(['-i', '/tmp/scratch/shot.png', '--search']))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/codex/codex-args.test.ts`
Expected: FAIL: the new cases fail because `imagePath` and `extraArgs` are not on `CodexArgsInput` and are not emitted.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/main/codex/codex-args.ts` with:

```typescript
import { CODEX } from '../config/constants'

export interface CodexArgsInput {
  prompt: string
  outputFile: string
  workdir: string
  model?: string
  /**
   * Absolute path to one image file. When set, the image is attached to the
   * prompt via `-i <path>`. Used for the optional meeting screenshot.
   */
  imagePath?: string
  /**
   * Extra codex flags appended just before the prompt. Used by Default
   * Actions, for example `['--search']` for the Fact check action.
   */
  extraArgs?: string[]
}

// Builds the argument vector for `codex exec`. The prompt is always the last
// element: `-i` image attachment and any extraArgs are inserted before it so
// codex parses them as flags rather than as positional prompt text.
export function buildCodexArgs(input: CodexArgsInput): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '-C',
    input.workdir,
    '-o',
    input.outputFile,
    '-c',
    `model_reasoning_effort="${CODEX.reasoningEffort}"`
  ]
  if (input.model) {
    args.push('-m', input.model)
  }
  if (input.imagePath) {
    args.push('-i', input.imagePath)
  }
  if (input.extraArgs && input.extraArgs.length > 0) {
    args.push(...input.extraArgs)
  }
  args.push(input.prompt)
  return args
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/codex/codex-args.test.ts`
Expected: PASS, all 11 cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. `imagePath` and `extraArgs` are optional, so `codex-service.ts` (the existing caller) still type-checks.

- [ ] **Step 6: Commit**

```bash
git add src/main/codex/codex-args.ts tests/main/codex/codex-args.test.ts
git commit -m "feat: support image attachment and extra flags in codex args"
```

---

## Task 3: Rolling transcript summarizer (T5.1)

**Files:**
- Create: `src/main/codex/transcript-context.ts`
- Modify: `src/main/codex/prompt-builder.ts`
- Test: `tests/main/codex/transcript-context.test.ts`
- Test: `tests/main/codex/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test for the summarizer**

Create `tests/main/codex/transcript-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildTranscriptContext } from '../../../src/main/codex/transcript-context'
import type { TranscriptSegment } from '../../../src/shared/types'

function seg(id: string, speaker: TranscriptSegment['speaker'], text: string): TranscriptSegment {
  return { id, speaker, text }
}

describe('buildTranscriptContext', () => {
  it('returns an empty string for no segments', () => {
    expect(buildTranscriptContext([], { recentSegments: 12, olderCharBudget: 1200, olderMarker: '[earlier in the meeting]' })).toBe('')
  })

  it('keeps every segment verbatim when the count is within the recent window', () => {
    const segments = [seg('1', 'you', 'hello there'), seg('2', 'them', 'hi back')]
    const result = buildTranscriptContext(segments, {
      recentSegments: 12,
      olderCharBudget: 1200,
      olderMarker: '[earlier in the meeting]'
    })
    expect(result).toContain('you: hello there')
    expect(result).toContain('them: hi back')
    expect(result).not.toContain('[earlier in the meeting]')
  })

  it('keeps the most recent N verbatim and digests the rest under the marker', () => {
    const segments = Array.from({ length: 20 }, (_, i) =>
      seg(String(i), i % 2 === 0 ? 'you' : 'them', `line ${i}`)
    )
    const result = buildTranscriptContext(segments, {
      recentSegments: 5,
      olderCharBudget: 1200,
      olderMarker: '[earlier in the meeting]'
    })
    expect(result).toContain('[earlier in the meeting]')
    // The 5 most recent (lines 15..19) appear verbatim with a speaker prefix.
    expect(result).toContain('them: line 19')
    expect(result).toContain('you: line 16')
    // An older line is part of the digest, not a verbatim recent line.
    expect(result).toContain('line 0')
  })

  it('truncates the older digest to the char budget', () => {
    const segments = Array.from({ length: 60 }, (_, i) =>
      seg(String(i), 'you', `a fairly long transcript line number ${i} with filler words`)
    )
    const budget = 200
    const result = buildTranscriptContext(segments, {
      recentSegments: 4,
      olderCharBudget: budget,
      olderMarker: '[earlier in the meeting]'
    })
    const markerIndex = result.indexOf('[earlier in the meeting]')
    const recentIndex = result.indexOf('you: a fairly long transcript line number 56')
    const digest = result.slice(markerIndex, recentIndex)
    // The digest body (excluding the marker line) stays within the budget.
    expect(digest.length).toBeLessThanOrEqual(budget + '[earlier in the meeting]'.length + 4)
  })

  it('does not mutate the input segments array', () => {
    const segments = [seg('1', 'you', 'one'), seg('2', 'you', 'two')]
    const copy = segments.map((s) => ({ ...s }))
    buildTranscriptContext(segments, {
      recentSegments: 1,
      olderCharBudget: 50,
      olderMarker: '[earlier in the meeting]'
    })
    expect(segments).toEqual(copy)
  })

  it('puts the digest before the recent verbatim segments', () => {
    const segments = Array.from({ length: 10 }, (_, i) => seg(String(i), 'you', `line ${i}`))
    const result = buildTranscriptContext(segments, {
      recentSegments: 3,
      olderCharBudget: 1200,
      olderMarker: '[earlier in the meeting]'
    })
    expect(result.indexOf('[earlier in the meeting]')).toBeLessThan(result.indexOf('line 9'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/codex/transcript-context.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/codex/transcript-context'`.

- [ ] **Step 3: Write the summarizer implementation**

Create `src/main/codex/transcript-context.ts`:

```typescript
import type { TranscriptSegment } from '../../shared/types'

export interface TranscriptContextOptions {
  /** How many of the most recent segments are kept verbatim. */
  recentSegments: number
  /** Character budget for the compacted digest of older segments. */
  olderCharBudget: number
  /** Prefix line that introduces the older-segment digest. */
  olderMarker: string
}

// Renders one segment as a speaker-prefixed line.
function renderLine(segment: TranscriptSegment): string {
  return `${segment.speaker}: ${segment.text.trim()}`
}

// Pure rolling transcript summarizer. As a meeting runs long the raw
// transcript would blow up the Codex prompt, so this keeps the prompt
// bounded: the most recent `recentSegments` segments are rendered verbatim,
// and everything older is compacted into a single digest truncated to
// `olderCharBudget` characters and introduced by `olderMarker`. It makes no
// Codex call: the compaction is a deterministic character-budget truncation,
// so the result is instant and fully testable. Never mutates the input.
export function buildTranscriptContext(
  segments: readonly TranscriptSegment[],
  options: TranscriptContextOptions
): string {
  if (segments.length === 0) return ''

  const recentCount = Math.max(0, options.recentSegments)
  const splitAt = Math.max(0, segments.length - recentCount)
  const older = segments.slice(0, splitAt)
  const recent = segments.slice(splitAt)

  const recentText = recent.map(renderLine).join('\n')

  if (older.length === 0) {
    return recentText
  }

  // Compact the older segments into one budgeted digest. The join is
  // truncated from the end so the digest never exceeds the budget; the
  // marker line is always kept in full.
  const olderJoined = older.map(renderLine).join('\n')
  const digestBody =
    olderJoined.length > options.olderCharBudget
      ? `${olderJoined.slice(0, options.olderCharBudget).trimEnd()}...`
      : olderJoined
  const digest = `${options.olderMarker}\n${digestBody}`

  return recentText.length > 0 ? `${digest}\n${recentText}` : digest
}
```

- [ ] **Step 4: Run the summarizer test to verify it passes**

Run: `npm run test -- tests/main/codex/transcript-context.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 5: Write the failing test for the transcript-aware prompt builder**

Replace the entire contents of `tests/main/codex/prompt-builder.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../../../src/main/codex/prompt-builder'

describe('buildPrompt', () => {
  it('includes the question text', () => {
    const prompt = buildPrompt('What is a closure?', '')
    expect(prompt).toContain('What is a closure?')
  })

  it('trims the question', () => {
    const prompt = buildPrompt('  spaced out  ', '')
    expect(prompt).toContain('Question: spaced out')
    expect(prompt).not.toContain('  spaced out  ')
  })

  it('states the real-time meeting copilot role', () => {
    const prompt = buildPrompt('hi', '')
    expect(prompt.toLowerCase()).toContain('meeting copilot')
  })

  it('omits the transcript section when the context is empty', () => {
    const prompt = buildPrompt('hi', '')
    expect(prompt).not.toContain('Meeting transcript:')
  })

  it('includes the transcript context when one is given', () => {
    const prompt = buildPrompt('What did they decide?', 'you: we should ship\nthem: agreed')
    expect(prompt).toContain('Meeting transcript:')
    expect(prompt).toContain('you: we should ship')
    expect(prompt).toContain('them: agreed')
  })

  it('puts the transcript before the question', () => {
    const prompt = buildPrompt('what was decided', 'you: the transcript')
    expect(prompt.indexOf('you: the transcript')).toBeLessThan(prompt.indexOf('what was decided'))
  })
})
```

- [ ] **Step 6: Run the prompt-builder test to verify it fails**

Run: `npm run test -- tests/main/codex/prompt-builder.test.ts`
Expected: FAIL: `buildPrompt` currently takes one argument, so the two-argument calls fail the new assertions.

Note: after the next step, `npm run typecheck` will report an error in `src/main/codex/codex-service.ts`, which still calls `buildPrompt` with one argument. This is the documented typecheck-red window; it is closed in Task 4. Do not fix `codex-service.ts` here.

- [ ] **Step 7: Rewrite the prompt builder**

Replace the entire contents of `src/main/codex/prompt-builder.ts` with:

```typescript
const SYSTEM_INSTRUCTION = [
  'You are a real-time meeting copilot.',
  'Answer the question directly and concisely in plain text.',
  'No markdown, no headings, no preamble - a few sentences at most.',
  'If the question is ambiguous, give the most useful brief answer anyway.',
  'When a meeting transcript is provided, ground your answer in it.'
].join(' ')

// Assembles the Codex prompt from the fixed system instruction, an optional
// bounded meeting-transcript context (produced by buildTranscriptContext),
// and the user's question. The transcript comes before the question so the
// model reads the meeting context first. An empty context is omitted
// entirely so a plain question prompt stays as small as before.
export function buildPrompt(question: string, transcriptContext: string): string {
  const parts = [SYSTEM_INSTRUCTION]
  const context = transcriptContext.trim()
  if (context.length > 0) {
    parts.push(`Meeting transcript:\n${context}`)
  }
  parts.push(`Question: ${question.trim()}`)
  return parts.join('\n\n')
}
```

- [ ] **Step 8: Run the prompt-builder test to verify it passes**

Run: `npm run test -- tests/main/codex/prompt-builder.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 9: Commit**

```bash
git add src/main/codex/transcript-context.ts src/main/codex/prompt-builder.ts tests/main/codex/transcript-context.test.ts tests/main/codex/prompt-builder.test.ts
git commit -m "feat: add rolling transcript summarizer and transcript-aware prompt builder"
```

---

## Task 4: Codex service context-ask path (T5.1, T5.2, T5.3)

This task closes the typecheck-red window opened in Task 3: it rewires `codex-service.ts` to the new `buildPrompt` signature and adds the `handleContextAsk` entry point.

**Files:**
- Modify: `src/main/codex/codex-service.ts`
- Test: `tests/main/codex/codex-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block to `tests/main/codex/codex-service.test.ts` inside the existing top-level area (keep every existing case; the file already mocks `runCodexQuery` and imports `createCodexService`). The screenshot-cleanup case needs the filesystem helpers, so add these imports alongside the existing ones at the top of the file:

```typescript
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
```

Then append this block:

```typescript
describe('createCodexService.handleContextAsk', () => {
  beforeEach(() => {
    runCodexQuery.mockReset()
  })

  it('runs a query that carries the transcript context and emits the answer', async () => {
    const emitted: Emitted[] = []
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ctx answer', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })
    await service.handleContextAsk({
      requestId: 'ctx-1',
      question: 'what next',
      segments: [{ id: 's1', speaker: 'them', text: 'we must hit the deadline' }],
      screenshot: false,
      extraArgs: []
    })
    const done = emitted.filter((e) => e.channel === IpcChannel.AnswerDone)
    expect(done).toHaveLength(1)
    expect((done[0].payload as { text: string }).text).toBe('ctx answer')
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    const prompt = passedArgs.at(-1) as string
    expect(prompt).toContain('we must hit the deadline')
  })

  it('passes extraArgs through to the codex args', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    await service.handleContextAsk({
      requestId: 'ctx-2',
      question: 'is that true',
      segments: [],
      screenshot: false,
      extraArgs: ['--search']
    })
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    expect(passedArgs).toContain('--search')
  })

  it('attaches the screenshot path with -i when one is provided', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    await service.handleContextAsk(
      {
        requestId: 'ctx-3',
        question: 'what is on screen',
        segments: [],
        screenshot: true,
        extraArgs: []
      },
      '/tmp/scratch/screenshots/shot-xyz.png'
    )
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    expect(passedArgs).toEqual(
      expect.arrayContaining(['-i', '/tmp/scratch/screenshots/shot-xyz.png'])
    )
  })

  it('deletes the screenshot file after the query completes', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    // A real temporary PNG that the runner's finally block must remove.
    const imagePath = join(tmpdir(), `codex-shot-${randomUUID()}.png`)
    await writeFile(imagePath, Buffer.from('png-bytes'))
    await service.handleContextAsk(
      {
        requestId: 'ctx-shot-cleanup',
        question: 'what is on screen',
        segments: [],
        screenshot: true,
        extraArgs: []
      },
      imagePath
    )
    // The file existed during the query and is gone once it finishes.
    await expect(access(imagePath)).rejects.toThrow()
  })

  it('does not attach an image when screenshot is true but no path is given', async () => {
    runCodexQuery.mockResolvedValueOnce({ ok: true, text: 'ok', error: '', diagnostic: '' })
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: () => {}
    })
    await service.handleContextAsk({
      requestId: 'ctx-4',
      question: 'q',
      segments: [],
      screenshot: true,
      extraArgs: []
    })
    const passedArgs = (runCodexQuery.mock.calls[0][0] as { args: string[] }).args
    expect(passedArgs).not.toContain('-i')
  })

  it('rejects a concurrent context-ask while a query is in flight', async () => {
    const emitted: Emitted[] = []
    let release: (() => void) | undefined
    let started: () => void = () => {}
    const startedP = new Promise<void>((resolve) => {
      started = resolve
    })
    runCodexQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          started()
          release = () => resolve({ ok: true, text: 'first', error: '', diagnostic: '' })
        })
    )
    const service = createCodexService({
      scratchRoot: scratch(),
      emit: (channel, payload) => emitted.push({ channel, payload })
    })
    const first = service.handleContextAsk({
      requestId: 'ctx-5',
      question: 'first',
      segments: [],
      screenshot: false,
      extraArgs: []
    })
    await startedP
    await service.handleContextAsk({
      requestId: 'ctx-6',
      question: 'second',
      segments: [],
      screenshot: false,
      extraArgs: []
    })
    const errors = emitted.filter((e) => e.channel === IpcChannel.AnswerError)
    expect(errors).toHaveLength(1)
    release?.()
    await first
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/codex/codex-service.test.ts`
Expected: FAIL: `service.handleContextAsk` is not a function.

- [ ] **Step 3: Rewrite the codex service**

Replace the entire contents of `src/main/codex/codex-service.ts` with:

```typescript
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { buildPrompt } from './prompt-builder'
import { buildTranscriptContext } from './transcript-context'
import { buildCodexArgs } from './codex-args'
import { runCodexQuery } from './codex-runner'
import { validateAskRequest } from './request-validation'
import { CODEX, CONTEXT } from '../config/constants'
import {
  IpcChannel,
  type AskQuestionRequest,
  type ContextAskRequest,
  type TranscriptSegment
} from '../../shared/types'

export interface CodexServiceDeps {
  /** Directory where per-query scratch files are written. */
  scratchRoot: string
  /** Sends an IPC payload to the renderer. */
  emit: (channel: string, payload: unknown) => void
  /** The codex binary; defaults to CODEX.command. Overridable for tests. */
  command?: string
}

export interface CodexService {
  /** Answers a plain question with no transcript or screenshot context. */
  handleAsk: (request: unknown) => Promise<void>
  /**
   * Answers a question grounded in the rolling transcript, optionally with a
   * screenshot attached. `screenshotPath`, when given, is the absolute path
   * of a PNG to attach via `-i`; it is the caller's pending screenshot file.
   */
  handleContextAsk: (request: unknown, screenshotPath?: string) => Promise<void>
}

function requestIdOf(request: unknown): string {
  if (request && typeof request === 'object') {
    const id = (request as Record<string, unknown>).requestId
    if (typeof id === 'string') return id
  }
  return ''
}

// Validates a ContextAskRequest. Reuses validateAskRequest for the requestId
// and question, then defensively normalizes the transcript and arg fields so
// untrusted renderer input cannot inject anything unexpected.
function validateContextRequest(value: unknown): ContextAskRequest {
  const base = validateAskRequest(value)
  const record = value as Record<string, unknown>
  const rawSegments = Array.isArray(record.segments) ? record.segments : []
  const segments = rawSegments.flatMap((entry): TranscriptSegment[] => {
    if (entry && typeof entry === 'object') {
      const seg = entry as Record<string, unknown>
      const speaker = seg.speaker
      if (
        typeof seg.id === 'string' &&
        (speaker === 'you' || speaker === 'them') &&
        typeof seg.text === 'string'
      ) {
        return [{ id: seg.id, speaker, text: seg.text }]
      }
    }
    return []
  })
  const rawExtra = Array.isArray(record.extraArgs) ? record.extraArgs : []
  const extraArgs = rawExtra.filter((arg): arg is string => typeof arg === 'string')
  return {
    requestId: base.requestId,
    question: base.question,
    segments,
    screenshot: record.screenshot === true,
    extraArgs
  }
}

export function createCodexService(deps: CodexServiceDeps): CodexService {
  // Single-flight guard: only one codex subprocess may run at a time. The
  // check-and-set runs with no await in between, so it is atomic on the
  // single JS thread. Shared by handleAsk and handleContextAsk.
  let inFlight = false

  // Runs one codex query and emits its streamed chunks, final answer, or
  // error. The prompt and args are fully assembled by the caller.
  async function runQuery(
    requestId: string,
    prompt: string,
    extraArgs: string[],
    imagePath: string | undefined
  ): Promise<void> {
    const outputFile = join(deps.scratchRoot, `answer-${requestId}.txt`)
    inFlight = true
    try {
      await mkdir(deps.scratchRoot, { recursive: true })
      const args = buildCodexArgs({
        prompt,
        outputFile,
        workdir: deps.scratchRoot,
        imagePath,
        extraArgs
      })
      const result = await runCodexQuery(
        {
          command: deps.command ?? CODEX.command,
          args,
          outputFile,
          timeoutMs: CODEX.timeoutMs
        },
        {
          onChunk: (delta) => deps.emit(IpcChannel.AnswerChunk, { requestId, delta })
        }
      )
      if (result.ok) {
        deps.emit(IpcChannel.AnswerDone, { requestId, text: result.text })
      } else {
        deps.emit(IpcChannel.AnswerError, { requestId, message: result.error })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Codex error.'
      deps.emit(IpcChannel.AnswerError, { requestId, message })
    } finally {
      inFlight = false
      await rm(outputFile, { force: true }).catch(() => {})
      // The screenshot file lives exactly as long as the answer file: it is
      // attached while the query runs and removed once the query finishes.
      if (imagePath) {
        await rm(imagePath, { force: true }).catch(() => {})
      }
    }
  }

  async function handleAsk(request: unknown): Promise<void> {
    if (inFlight) {
      deps.emit(IpcChannel.AnswerError, {
        requestId: requestIdOf(request),
        message: 'A question is already being processed. Wait for the current answer to finish.'
      })
      return
    }
    let validated: AskQuestionRequest
    try {
      validated = validateAskRequest(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid question request.'
      deps.emit(IpcChannel.AnswerError, { requestId: requestIdOf(request), message })
      return
    }
    await runQuery(validated.requestId, buildPrompt(validated.question, ''), [], undefined)
  }

  async function handleContextAsk(request: unknown, screenshotPath?: string): Promise<void> {
    if (inFlight) {
      deps.emit(IpcChannel.AnswerError, {
        requestId: requestIdOf(request),
        message: 'A question is already being processed. Wait for the current answer to finish.'
      })
      return
    }
    let validated: ContextAskRequest
    try {
      validated = validateContextRequest(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid question request.'
      deps.emit(IpcChannel.AnswerError, { requestId: requestIdOf(request), message })
      return
    }
    const context = buildTranscriptContext(validated.segments, {
      recentSegments: CONTEXT.recentSegments,
      olderCharBudget: CONTEXT.olderCharBudget,
      olderMarker: CONTEXT.olderMarker
    })
    const prompt = buildPrompt(validated.question, context)
    // Attach the screenshot only when the request asked for one and a real
    // file path is available; otherwise fall back to a plain text query.
    const imagePath = validated.screenshot ? screenshotPath : undefined
    await runQuery(validated.requestId, prompt, validated.extraArgs, imagePath)
  }

  return { handleAsk, handleContextAsk }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/codex/codex-service.test.ts`
Expected: PASS, every existing case plus the six new `handleContextAsk` cases green.

- [ ] **Step 5: Typecheck (closes the typecheck-red window)**

Run: `npm run typecheck`
Expected: PASS, no type errors. The Task 3 break in `codex-service.ts` is now resolved: this file calls the two-argument `buildPrompt`.

- [ ] **Step 6: Run the full Codex test suite**

Run: `npm run test -- tests/main/codex`
Expected: PASS, every Codex test file green.

- [ ] **Step 7: Commit**

```bash
git add src/main/codex/codex-service.ts tests/main/codex/codex-service.test.ts
git commit -m "feat: add transcript-and-screenshot-aware Codex context-ask path"
```

---

## Task 5: Default Actions table (T5.3)

**Files:**
- Create: `src/main/codex/default-actions.ts`
- Test: `tests/main/codex/default-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/codex/default-actions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ACTIONS,
  findDefaultAction
} from '../../../src/main/codex/default-actions'

describe('DEFAULT_ACTIONS', () => {
  it('defines exactly the five spec actions', () => {
    const ids = DEFAULT_ACTIONS.map((a) => a.id)
    expect(ids).toEqual(['say-next', 'follow-up', 'fact-check', 'recap', 'coding-help'])
  })

  it('gives every action a non-empty label and prompt template', () => {
    for (const action of DEFAULT_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0)
      expect(action.promptTemplate.length).toBeGreaterThan(0)
    }
  })

  it('adds --search only for the fact-check action', () => {
    for (const action of DEFAULT_ACTIONS) {
      if (action.id === 'fact-check') {
        expect(action.extraArgs).toContain('--search')
      } else {
        expect(action.extraArgs).not.toContain('--search')
      }
    }
  })

  it('labels the coding-help action as Smart Mode', () => {
    const coding = DEFAULT_ACTIONS.find((a) => a.id === 'coding-help')
    expect(coding?.label.toLowerCase()).toContain('coding')
  })
})

describe('findDefaultAction', () => {
  it('returns the matching action by id', () => {
    expect(findDefaultAction('recap')?.id).toBe('recap')
  })

  it('returns undefined for an unknown id', () => {
    expect(findDefaultAction('not-an-action')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/codex/default-actions.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/codex/default-actions'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/codex/default-actions.ts`:

```typescript
import type { DefaultActionId } from '../../shared/types'

export interface DefaultAction {
  /** Stable id, matches the DefaultActionId union. */
  id: DefaultActionId
  /** Button label shown in the renderer. */
  label: string
  /**
   * The question text fed to the Codex context-ask path. The rolling
   * transcript is attached separately by the prompt builder, so the
   * template is phrased as an instruction over "the meeting so far".
   */
  promptTemplate: string
  /** Extra codex flags this action contributes, for example `--search`. */
  extraArgs: string[]
}

// The five Default Actions cloned from Cluely Live Insights (design spec
// section 12). Each maps to a preset prompt fed to the existing Codex
// context-ask path. Only Fact check adds `--search`; the rest run a normal
// read-only query. Pure data: no I/O, fully unit-testable.
export const DEFAULT_ACTIONS: readonly DefaultAction[] = [
  {
    id: 'say-next',
    label: 'What should I say next',
    promptTemplate:
      'Based on the meeting so far, suggest what I should say next. Give one concise, natural response I could speak now.',
    extraArgs: []
  },
  {
    id: 'follow-up',
    label: 'Follow-up questions',
    promptTemplate:
      'Based on the meeting so far, suggest two or three sharp follow-up questions I could ask next.',
    extraArgs: []
  },
  {
    id: 'fact-check',
    label: 'Fact check',
    promptTemplate:
      'Fact check the most recent claims made in the meeting. State briefly whether each is accurate and correct anything wrong.',
    extraArgs: ['--search']
  },
  {
    id: 'recap',
    label: 'Recap',
    promptTemplate:
      'Recap the meeting so far in a few concise sentences: the key points and any decisions.',
    extraArgs: []
  },
  {
    id: 'coding-help',
    label: 'Coding help (Smart Mode)',
    promptTemplate:
      'Based on the meeting so far, give concise coding help for the technical problem under discussion.',
    extraArgs: []
  }
]

// Looks up a Default Action by id. Returns undefined for an unknown id.
export function findDefaultAction(id: string): DefaultAction | undefined {
  return DEFAULT_ACTIONS.find((action) => action.id === id)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/codex/default-actions.test.ts`
Expected: PASS, 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/codex/default-actions.ts tests/main/codex/default-actions.test.ts
git commit -m "feat: add Default Actions preset table"
```

---

## Task 6: Dynamic insight detector (T5.4)

**Files:**
- Create: `src/main/insights/insight-detector.ts`
- Test: `tests/main/insights/insight-detector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/insights/insight-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { detectInsights } from '../../../src/main/insights/insight-detector'
import type { TranscriptSegment } from '../../../src/shared/types'

function seg(id: string, text: string, speaker: TranscriptSegment['speaker'] = 'them'): TranscriptSegment {
  return { id, speaker, text }
}

const OPTS = {
  keywords: ['deadline', 'budget', 'action item'],
  maxSurfaced: 5
}

describe('detectInsights', () => {
  it('returns no insights for an empty transcript', () => {
    expect(detectInsights([], OPTS)).toEqual([])
  })

  it('detects a segment ending in a question mark as a question insight', () => {
    const insights = detectInsights([seg('1', 'Can you send the file?')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('question')
    expect(insights[0].sourceSegmentId).toBe('1')
  })

  it('detects an interrogative opener without a question mark', () => {
    const insights = detectInsights([seg('1', 'what is the current status')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('question')
  })

  it('detects a salient keyword as a keyword insight', () => {
    const insights = detectInsights([seg('1', 'we need to lock the budget today')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('keyword')
  })

  it('matches keywords case-insensitively', () => {
    const insights = detectInsights([seg('1', 'The DEADLINE moved up')], OPTS)
    expect(insights[0].kind).toBe('keyword')
  })

  it('matches a multi-word keyword', () => {
    const insights = detectInsights([seg('1', 'the first action item is mine')], OPTS)
    expect(insights[0].kind).toBe('keyword')
  })

  it('ignores plain statements that are neither a question nor a keyword', () => {
    expect(detectInsights([seg('1', 'I had coffee this morning')], OPTS)).toEqual([])
  })

  it('treats a segment as a question when it is both a question and a keyword', () => {
    const insights = detectInsights([seg('1', 'what is the budget?')], OPTS)
    expect(insights).toHaveLength(1)
    expect(insights[0].kind).toBe('question')
  })

  it('ranks questions before keyword insights', () => {
    const insights = detectInsights(
      [seg('1', 'the budget is tight'), seg('2', 'when do we ship?')],
      OPTS
    )
    expect(insights[0].kind).toBe('question')
    expect(insights[1].kind).toBe('keyword')
  })

  it('de-duplicates insights with the same normalized text', () => {
    const insights = detectInsights(
      [seg('1', 'When do we ship?'), seg('2', 'when do we ship?')],
      OPTS
    )
    expect(insights).toHaveLength(1)
  })

  it('caps the result at maxSurfaced', () => {
    const segments = Array.from({ length: 10 }, (_, i) => seg(String(i), `question ${i}?`))
    const insights = detectInsights(segments, { keywords: [], maxSurfaced: 3 })
    expect(insights).toHaveLength(3)
  })

  it('gives every insight a stable non-empty id and a label', () => {
    const insights = detectInsights([seg('1', 'what is next?')], OPTS)
    expect(insights[0].id.length).toBeGreaterThan(0)
    expect(insights[0].label.length).toBeGreaterThan(0)
  })

  it('does not mutate the input segments', () => {
    const segments = [seg('1', 'what now?')]
    const copy = segments.map((s) => ({ ...s }))
    detectInsights(segments, OPTS)
    expect(segments).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/insights/insight-detector.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/insights/insight-detector'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/insights/insight-detector.ts`:

```typescript
import type { TranscriptSegment } from '../../shared/types'

/** One detected insight surfaced below the command bar. */
export interface Insight {
  /** Stable id derived from the source segment. */
  id: string
  /** Whether this insight is a detected question or a keyword hit. */
  kind: 'question' | 'keyword'
  /** The transcript segment this insight came from. */
  sourceSegmentId: string
  /** Short, prompt-ready label shown in the UI and used to answer it. */
  label: string
}

export interface DetectInsightsOptions {
  /** Lowercase salient terms; matched case-insensitively as substrings. */
  keywords: readonly string[]
  /** The result is capped at this many insights. */
  maxSurfaced: number
}

// Words that, as the first token of a segment, mark it as a question even
// without a trailing question mark.
const INTERROGATIVES = new Set([
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'which',
  'whose',
  'can',
  'could',
  'should',
  'would',
  'do',
  'does',
  'did',
  'is',
  'are',
  'will'
])

// Normalizes text for de-duplication: lowercased, trimmed, collapsed spaces.
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

// True when the segment text reads as a question: a trailing '?' or an
// interrogative first word.
function isQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (trimmed.endsWith('?')) return true
  const firstWord = trimmed.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '')
  return INTERROGATIVES.has(firstWord)
}

// True when the segment text contains any salient keyword.
function hasKeyword(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((keyword) => lower.includes(keyword))
}

// Pure rule-based dynamic insight detector. It scans every transcript
// segment, flags the ones that read as a question or carry a salient
// keyword, ranks questions before keyword hits (each group kept in
// transcript order), de-duplicates by normalized text, and caps the result.
// No model and no network: every rule is deterministic, so the whole module
// is unit-testable. Never mutates the input.
export function detectInsights(
  segments: readonly TranscriptSegment[],
  options: DetectInsightsOptions
): Insight[] {
  const questions: Insight[] = []
  const keywords: Insight[] = []
  const seen = new Set<string>()

  for (const segment of segments) {
    const text = segment.text.trim()
    if (text.length === 0) continue
    const key = normalize(text)
    if (seen.has(key)) continue

    if (isQuestion(text)) {
      seen.add(key)
      questions.push({
        id: `insight-${segment.id}`,
        kind: 'question',
        sourceSegmentId: segment.id,
        label: text
      })
    } else if (hasKeyword(text, options.keywords)) {
      seen.add(key)
      keywords.push({
        id: `insight-${segment.id}`,
        kind: 'keyword',
        sourceSegmentId: segment.id,
        label: text
      })
    }
  }

  return [...questions, ...keywords].slice(0, Math.max(0, options.maxSurfaced))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/insights/insight-detector.test.ts`
Expected: PASS, 13 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/insight-detector.ts tests/main/insights/insight-detector.test.ts
git commit -m "feat: add rule-based dynamic insight detector"
```

---

## Task 7: Session manager state machine (T5.5)

**Files:**
- Create: `src/main/session/session-manager.ts`
- Test: `tests/main/session/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/session/session-manager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  createSession,
  startSession,
  stopSession,
  insightsEnabled,
  type SessionState
} from '../../../src/main/session/session-manager'

describe('session-manager', () => {
  it('starts idle', () => {
    expect(createSession().status).toBe('idle')
  })

  it('an idle session has insights disabled', () => {
    expect(insightsEnabled(createSession())).toBe(false)
  })

  it('starting an idle session makes it active', () => {
    const active = startSession(createSession())
    expect(active.status).toBe('active')
  })

  it('an active session has insights enabled', () => {
    expect(insightsEnabled(startSession(createSession()))).toBe(true)
  })

  it('stopping an active session makes it ended', () => {
    const ended = stopSession(startSession(createSession()))
    expect(ended.status).toBe('ended')
  })

  it('an ended session has insights disabled', () => {
    expect(insightsEnabled(stopSession(startSession(createSession())))).toBe(false)
  })

  it('starting an ended session begins a fresh active session', () => {
    const restarted = startSession(stopSession(startSession(createSession())))
    expect(restarted.status).toBe('active')
  })

  it('starting an already-active session is a no-op that stays active', () => {
    const once = startSession(createSession())
    const twice = startSession(once)
    expect(twice.status).toBe('active')
  })

  it('stopping an idle session is a no-op that stays idle', () => {
    const stopped = stopSession(createSession())
    expect(stopped.status).toBe('idle')
  })

  it('does not mutate the input state', () => {
    const idle: SessionState = createSession()
    startSession(idle)
    expect(idle.status).toBe('idle')
  })

  it('bumps the session id on each fresh start so a restart is distinguishable', () => {
    const first = startSession(createSession())
    const second = startSession(stopSession(first))
    expect(second.id).not.toBe(first.id)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/session/session-manager.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/session/session-manager'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/session/session-manager.ts`:

```typescript
/** The lifecycle status of a meeting session. */
export type SessionStatus = 'idle' | 'active' | 'ended'

export interface SessionState {
  /** Where the session is in its lifecycle. */
  readonly status: SessionStatus
  /**
   * A counter that increments on every fresh start. It distinguishes one
   * meeting session from the next so a restart never inherits stale state.
   */
  readonly id: number
}

// Creates a fresh idle session. No meeting is running and no insights show.
export function createSession(): SessionState {
  return { status: 'idle', id: 0 }
}

// Starts a meeting session. From `idle` or `ended` this begins a new active
// session with a bumped id; an already-active session is returned unchanged.
// Immutable: returns a new state, never mutates the input.
export function startSession(state: SessionState): SessionState {
  if (state.status === 'active') return state
  return { status: 'active', id: state.id + 1 }
}

// Stops a meeting session. An active session becomes `ended` (its state is
// frozen); an idle session is returned unchanged. Immutable.
export function stopSession(state: SessionState): SessionState {
  if (state.status !== 'active') return state
  return { status: 'ended', id: state.id }
}

// True only while a session is active. The overlay surfaces dynamic insights
// only when this is true, matching Cluely's session-scoped insight model.
export function insightsEnabled(state: SessionState): boolean {
  return state.status === 'active'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/session/session-manager.test.ts`
Expected: PASS, 11 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/session/session-manager.ts tests/main/session/session-manager.test.ts
git commit -m "feat: add meeting session state machine"
```

---

## Task 8: Screenshot store (T5.2)

**Files:**
- Create: `src/main/screenshots/screenshot-store.ts`
- Test: `tests/main/screenshots/screenshot-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/screenshots/screenshot-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/screenshots/screenshot-store.test.ts`
Expected: FAIL with `Cannot find module '../../../src/main/screenshots/screenshot-store'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/screenshots/screenshot-store.ts`:

```typescript
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
   * Returns the pending screenshot path and clears the pending slot. Returns
   * undefined when nothing is pending. The file is left on disk so the Codex
   * runner can attach it with `-i`; the runner deletes it after the query
   * completes. Performs no I/O, so it is synchronous.
   */
  consume: () => string | undefined
}

// Holds at most one pending screenshot. Sidecar screenshots arrive as base64
// PNGs; this store decodes them to real files in the Codex scratch dir so the
// Codex runner can attach them with `-i`. A new screenshot replaces the old
// one (its file is deleted). Consuming the pending screenshot only clears the
// slot and returns the path: the Codex runner deletes the file after the
// query, so the file survives long enough for codex to read it.
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

  function consume(): string | undefined {
    const path = pending
    if (!path) return undefined
    pending = undefined
    return path
  }

  return { save, pendingPath, consume }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/main/screenshots/screenshot-store.test.ts`
Expected: PASS, 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/screenshots/screenshot-store.ts tests/main/screenshots/screenshot-store.test.ts
git commit -m "feat: add pending-screenshot store for Codex attachment"
```

---

## Task 9: IPC handlers for context-ask and screenshot request (T5.2, T5.3)

**Files:**
- Modify: `src/main/ipc/ipc-handlers.ts`
- Test: `tests/main/ipc/ipc-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/main/ipc/ipc-handlers.test.ts` with this version (it keeps every existing case and adds the two Phase 5 channels):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

function makeDeps() {
  return {
    onToggleInvisibility: vi.fn(),
    onAskQuestion: vi.fn(),
    onAskContextQuestion: vi.fn(),
    onStartTranscription: vi.fn(),
    onStopTranscription: vi.fn(),
    onRequestScreenshot: vi.fn()
  }
}

function makeIpc(): {
  ipcMain: { on: ReturnType<typeof vi.fn> }
  handlers: Record<string, (...args: unknown[]) => void>
} {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const ipcMain = {
    on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
      handlers[c] = l
    })
  }
  return { ipcMain, handlers }
}

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('forwards the request payload when the AskQuestion channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-1', question: 'hello' }
    handlers[IpcChannel.AskQuestion]({}, request)
    expect(deps.onAskQuestion).toHaveBeenCalledWith(request)
  })

  it('forwards the request payload when the AskContextQuestion channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-2', question: 'recap', segments: [], screenshot: false, extraArgs: [] }
    handlers[IpcChannel.AskContextQuestion]({}, request)
    expect(deps.onAskContextQuestion).toHaveBeenCalledWith(request)
  })

  it('calls onStartTranscription when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StartTranscription]()
    expect(deps.onStartTranscription).toHaveBeenCalledOnce()
  })

  it('calls onStopTranscription when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.StopTranscription]()
    expect(deps.onStopTranscription).toHaveBeenCalledOnce()
  })

  it('calls onRequestScreenshot when its channel receives a message', () => {
    const { ipcMain, handlers } = makeIpc()
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.RequestScreenshot]()
    expect(deps.onRequestScreenshot).toHaveBeenCalledOnce()
  })

  it('does not register the removed AudioFrame channel', () => {
    const { ipcMain, handlers } = makeIpc()
    registerIpcHandlers(ipcMain, makeDeps())
    expect(handlers['transcription:audio-frame']).toBeUndefined()
  })

  it('registers exactly six channel handlers', () => {
    const { ipcMain } = makeIpc()
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledTimes(6)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/main/ipc/ipc-handlers.test.ts`
Expected: FAIL: `IpcChannel.AskContextQuestion` handler is undefined and the count is 4, not 6.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/main/ipc/ipc-handlers.ts` with:

```typescript
import { IpcChannel } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
  onAskQuestion(request: unknown): void
  /** A transcript-and-screenshot-aware Codex query from the renderer. */
  onAskContextQuestion(request: unknown): void
  onStartTranscription(): void
  onStopTranscription(): void
  /** The renderer asked the sidecar to capture a screenshot. */
  onRequestScreenshot(): void
}

// Registers the renderer-to-main IPC channels. Phase 5 adds two: a
// transcript-and-screenshot-aware context-ask channel and a screenshot
// request channel that drives the sidecar.
export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1])
  })
  ipcMain.on(IpcChannel.AskContextQuestion, (...args: unknown[]) => {
    deps.onAskContextQuestion(args[1])
  })
  ipcMain.on(IpcChannel.StartTranscription, () => deps.onStartTranscription())
  ipcMain.on(IpcChannel.StopTranscription, () => deps.onStopTranscription())
  ipcMain.on(IpcChannel.RequestScreenshot, () => deps.onRequestScreenshot())
}
```

- [ ] **Step 4: Run the test to verify it fails on the consumer**

Run: `npm run typecheck`
Expected: FAIL in `src/main/index.ts`: `registerIpcHandlers` is now called with an `IpcHandlerDeps` missing `onAskContextQuestion` and `onRequestScreenshot`. This is expected and is fixed in Task 13. Note it and proceed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/main/ipc/ipc-handlers.test.ts`
Expected: PASS, 8 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/ipc-handlers.ts tests/main/ipc/ipc-handlers.test.ts
git commit -m "feat: register context-ask and screenshot-request IPC channels"
```

---

## Task 10: Preload API for context-ask and screenshot request (T5.2, T5.3)

**Files:**
- Modify: `src/preload/api.ts`
- Test: `tests/preload/api.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block to `tests/preload/api.test.ts` inside the existing top-level area (keep every existing import and case):

```typescript
describe('OverlayApi Phase 5 surface', () => {
  it('askContextQuestion sends the request on the context-ask channel', () => {
    const sent: Array<{ channel: string; args: unknown[] }> = []
    const ipc = {
      send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
      on: () => {}
    }
    const api = createOverlayApi(ipc)
    const request = {
      requestId: 'r-1',
      question: 'recap',
      segments: [],
      screenshot: false,
      extraArgs: []
    }
    api.askContextQuestion(request)
    expect(sent[0].channel).toBe('codex:ask-context')
    expect(sent[0].args[0]).toEqual(request)
  })

  it('requestScreenshot sends on the screenshot-request channel', () => {
    const sent: Array<{ channel: string }> = []
    const ipc = {
      send: (channel: string) => sent.push({ channel }),
      on: () => {}
    }
    const api = createOverlayApi(ipc)
    api.requestScreenshot()
    expect(sent[0].channel).toBe('sidecar:request-screenshot')
  })
})
```

If `tests/preload/api.test.ts` does not already import `createOverlayApi`, add `import { createOverlayApi } from '../../src/preload/api'` and `import { describe, it, expect } from 'vitest'` at the top alongside the existing imports (do not duplicate an import that is already present).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/preload/api.test.ts`
Expected: FAIL: `api.askContextQuestion` and `api.requestScreenshot` are not functions.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/preload/api.ts` with:

```typescript
import {
  IpcChannel,
  type OverlayState,
  type AskQuestionRequest,
  type ContextAskRequest,
  type AnswerChunk,
  type AnswerResult,
  type AnswerError,
  type CodexStatus,
  type TranscriptUpdatePayload,
  type TranscriptionStatusPayload,
  type SidecarStatusPayload,
  type ScreenshotPayload
} from '../shared/types'

export interface IpcRendererLike {
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: unknown[]) => void): void
  removeListener?(channel: string, listener: (...args: unknown[]) => void): void
}

export interface OverlayApi {
  toggleInvisibility(): void
  onOverlayState(callback: (state: OverlayState) => void): () => void
  askQuestion(request: AskQuestionRequest): void
  askContextQuestion(request: ContextAskRequest): void
  requestScreenshot(): void
  onAnswerChunk(callback: (chunk: AnswerChunk) => void): () => void
  onAnswerDone(callback: (result: AnswerResult) => void): () => void
  onAnswerError(callback: (error: AnswerError) => void): () => void
  onCodexStatus(callback: (status: CodexStatus) => void): () => void
  startTranscription(): void
  stopTranscription(): void
  onTranscriptUpdate(callback: (update: TranscriptUpdatePayload) => void): () => void
  onTranscriptionStatus(callback: (status: TranscriptionStatusPayload) => void): () => void
  onSidecarStatus(callback: (status: SidecarStatusPayload) => void): () => void
  onScreenshot(callback: (screenshot: ScreenshotPayload) => void): () => void
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
    askQuestion: (request) => ipcRenderer.send(IpcChannel.AskQuestion, request),
    askContextQuestion: (request) => ipcRenderer.send(IpcChannel.AskContextQuestion, request),
    requestScreenshot: () => ipcRenderer.send(IpcChannel.RequestScreenshot),
    onAnswerChunk: (callback) => subscribe(IpcChannel.AnswerChunk, callback),
    onAnswerDone: (callback) => subscribe(IpcChannel.AnswerDone, callback),
    onAnswerError: (callback) => subscribe(IpcChannel.AnswerError, callback),
    onCodexStatus: (callback) => subscribe(IpcChannel.CodexStatus, callback),
    startTranscription: () => ipcRenderer.send(IpcChannel.StartTranscription),
    stopTranscription: () => ipcRenderer.send(IpcChannel.StopTranscription),
    onTranscriptUpdate: (callback) => subscribe(IpcChannel.TranscriptUpdate, callback),
    onTranscriptionStatus: (callback) => subscribe(IpcChannel.TranscriptionStatus, callback),
    onSidecarStatus: (callback) => subscribe(IpcChannel.SidecarStatus, callback),
    onScreenshot: (callback) => subscribe(IpcChannel.Screenshot, callback)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/preload/api.test.ts`
Expected: PASS, every existing case plus the two new cases green.

- [ ] **Step 5: Commit**

```bash
git add src/preload/api.ts tests/preload/api.test.ts
git commit -m "feat: add context-ask and screenshot-request to preload API"
```

---

## Task 11: DefaultActions and InsightList renderer components (T5.3, T5.4)

**Files:**
- Create: `src/renderer/src/components/DefaultActions.tsx`
- Create: `src/renderer/src/components/InsightList.tsx`
- Modify: `src/renderer/src/styles/theme.css`
- Test: `tests/renderer/components/DefaultActions.test.tsx`
- Test: `tests/renderer/components/InsightList.test.tsx`

- [ ] **Step 1: Write the failing test for DefaultActions**

Create `tests/renderer/components/DefaultActions.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DefaultActions } from '../../../src/renderer/src/components/DefaultActions'

describe('DefaultActions', () => {
  it('renders a button for each of the five preset actions', () => {
    render(<DefaultActions onAction={vi.fn()} disabled={false} />)
    expect(screen.getByRole('button', { name: 'What should I say next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Follow-up questions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fact check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coding help (Smart Mode)' })).toBeInTheDocument()
  })

  it('calls onAction with the action id when a button is clicked', async () => {
    const onAction = vi.fn()
    render(<DefaultActions onAction={onAction} disabled={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    expect(onAction).toHaveBeenCalledWith('recap')
  })

  it('disables every button when disabled is true', () => {
    render(<DefaultActions onAction={vi.fn()} disabled={true} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('does not call onAction while disabled', async () => {
    const onAction = vi.fn()
    render(<DefaultActions onAction={onAction} disabled={true} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fact check' }))
    expect(onAction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/components/DefaultActions.test.tsx`
Expected: FAIL with `Cannot find module '.../components/DefaultActions'`.

- [ ] **Step 3: Write the DefaultActions component**

Create `src/renderer/src/components/DefaultActions.tsx`:

```typescript
import React from 'react'
import { DEFAULT_ACTIONS } from '../../../main/codex/default-actions'
import type { DefaultActionId } from '../../../shared/types'

interface DefaultActionsProps {
  /** Called with the chosen Default Action id. */
  onAction: (id: DefaultActionId) => void
  /** Disables every button (for example while a query is in flight). */
  disabled: boolean
}

// A row of black-and-white Default Action buttons. Each maps to a preset
// prompt from the shared DEFAULT_ACTIONS table; clicking one hands its id to
// the parent, which sends the matching context-ask query.
export function DefaultActions({ onAction, disabled }: DefaultActionsProps): React.JSX.Element {
  return (
    <div className="default-actions">
      {DEFAULT_ACTIONS.map((action) => (
        <button
          key={action.id}
          className="default-actions__button"
          disabled={disabled}
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/components/DefaultActions.test.tsx`
Expected: PASS, 4 cases green.

- [ ] **Step 5: Write the failing test for InsightList**

Create `tests/renderer/components/InsightList.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InsightList } from '../../../src/renderer/src/components/InsightList'
import type { Insight } from '../../../src/main/insights/insight-detector'

const insights: Insight[] = [
  { id: 'insight-1', kind: 'question', sourceSegmentId: '1', label: 'When do we ship?' },
  { id: 'insight-2', kind: 'keyword', sourceSegmentId: '2', label: 'the budget is tight' }
]

describe('InsightList', () => {
  it('renders nothing when there are no insights', () => {
    const { container } = render(<InsightList insights={[]} onAnswer={vi.fn()} disabled={false} />)
    expect(container.querySelector('.insight-list')).toBeNull()
  })

  it('renders one row per insight with its label', () => {
    render(<InsightList insights={insights} onAnswer={vi.fn()} disabled={false} />)
    expect(screen.getByText('When do we ship?')).toBeInTheDocument()
    expect(screen.getByText('the budget is tight')).toBeInTheDocument()
  })

  it('calls onAnswer with the insight when its row is clicked', async () => {
    const onAnswer = vi.fn()
    render(<InsightList insights={insights} onAnswer={onAnswer} disabled={false} />)
    await userEvent.click(screen.getByRole('button', { name: /When do we ship/ }))
    expect(onAnswer).toHaveBeenCalledWith(insights[0])
  })

  it('disables every insight button when disabled is true', () => {
    render(<InsightList insights={insights} onAnswer={vi.fn()} disabled={true} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/components/InsightList.test.tsx`
Expected: FAIL with `Cannot find module '.../components/InsightList'`.

- [ ] **Step 7: Write the InsightList component**

Create `src/renderer/src/components/InsightList.tsx`:

```typescript
import React from 'react'
import type { Insight } from '../../../main/insights/insight-detector'

interface InsightListProps {
  /** The ranked dynamic insights to surface. */
  insights: Insight[]
  /** Called with the insight to answer when its row is clicked. */
  onAnswer: (insight: Insight) => void
  /** Disables every insight button (for example while a query is in flight). */
  disabled: boolean
}

// The dynamic-insight surface shown below the command bar during an active
// session. Each insight is a button: clicking it (or pressing Tab for the
// first one, handled in App) answers it via the Codex context-ask path. The
// component renders nothing when there are no insights.
export function InsightList({ insights, onAnswer, disabled }: InsightListProps): React.JSX.Element | null {
  if (insights.length === 0) return null
  return (
    <div className="insight-list">
      {insights.map((insight) => (
        <button
          key={insight.id}
          className="insight-list__item"
          disabled={disabled}
          onClick={() => onAnswer(insight)}
        >
          <span className="insight-list__kind">{insight.kind}</span>
          <span className="insight-list__label">{insight.label}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/components/InsightList.test.tsx`
Expected: PASS, 4 cases green.

- [ ] **Step 9: Add the black-and-white styling**

Append this block to the end of `src/renderer/src/styles/theme.css`:

```css
.default-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.default-actions__button {
  padding: 6px 10px;
  font-size: 12px;
  color: #f5f5f5;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  cursor: pointer;
}

.default-actions__button:disabled {
  opacity: 0.4;
  cursor: default;
}

.insight-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.insight-list__item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 8px;
  font-size: 12px;
  text-align: left;
  color: #f5f5f5;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  cursor: pointer;
}

.insight-list__item:disabled {
  opacity: 0.4;
  cursor: default;
}

.insight-list__kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.command-bar__screenshot {
  padding: 8px 10px;
  color: #f5f5f5;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  cursor: pointer;
}
```

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/DefaultActions.tsx src/renderer/src/components/InsightList.tsx src/renderer/src/styles/theme.css tests/renderer/components/DefaultActions.test.tsx tests/renderer/components/InsightList.test.tsx
git commit -m "feat: add DefaultActions and InsightList renderer components"
```

---

## Task 12: useInsights and useSession hooks (T5.4, T5.5)

**Files:**
- Create: `src/renderer/src/insights/detect-insights.ts`
- Create: `src/renderer/src/hooks/useInsights.ts`
- Create: `src/renderer/src/hooks/useSession.ts`
- Test: `tests/renderer/hooks/useInsights.test.ts`
- Test: `tests/renderer/hooks/useSession.test.ts`

- [ ] **Step 1: Create the renderer-side detector import boundary**

Create `src/renderer/src/insights/detect-insights.ts`:

```typescript
// Thin import boundary so renderer code depends on the pure insight detector
// without reaching deep into src/main in every component. The detector logic
// itself is the shared pure module; this file only re-exports it.
export { detectInsights } from '../../../main/insights/insight-detector'
export type { Insight, DetectInsightsOptions } from '../../../main/insights/insight-detector'
```

- [ ] **Step 2: Write the failing test for useInsights**

Create `tests/renderer/hooks/useInsights.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInsights } from '../../../src/renderer/src/hooks/useInsights'
import type { TranscriptSegment } from '../../../src/shared/types'

function seg(id: string, text: string): TranscriptSegment {
  return { id, speaker: 'them', text }
}

describe('useInsights', () => {
  it('returns no insights when the session is inactive', () => {
    const segments = [seg('1', 'when do we ship?')]
    const { result } = renderHook(() => useInsights(segments, false))
    expect(result.current.insights).toEqual([])
  })

  it('detects insights from the transcript while the session is active', () => {
    const segments = [seg('1', 'when do we ship?'), seg('2', 'I had lunch')]
    const { result } = renderHook(() => useInsights(segments, true))
    expect(result.current.insights).toHaveLength(1)
    expect(result.current.insights[0].kind).toBe('question')
  })

  it('exposes the first insight as firstInsight', () => {
    const segments = [seg('1', 'what is the budget?')]
    const { result } = renderHook(() => useInsights(segments, true))
    expect(result.current.firstInsight?.sourceSegmentId).toBe('1')
  })

  it('firstInsight is undefined when there are no insights', () => {
    const { result } = renderHook(() => useInsights([], true))
    expect(result.current.firstInsight).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/hooks/useInsights.test.ts`
Expected: FAIL with `Cannot find module '.../hooks/useInsights'`.

- [ ] **Step 4: Write the useInsights hook**

Create `src/renderer/src/hooks/useInsights.ts`:

```typescript
import { useMemo } from 'react'
import { detectInsights, type Insight } from '../insights/detect-insights'
import { INSIGHTS } from '../../../main/config/constants'
import type { TranscriptSegment } from '../../../shared/types'

export interface UseInsights {
  /** The ranked dynamic insights, empty while the session is inactive. */
  insights: Insight[]
  /** The first insight, the one the Tab hotkey answers. */
  firstInsight: Insight | undefined
}

// Runs the pure rule-based insight detector over the live transcript while a
// session is active. When the session is inactive it returns no insights, so
// the overlay surfaces insights only during a meeting (matching Cluely's
// session-scoped model). The detection itself is deterministic and memoized
// on the segments and the active flag.
export function useInsights(segments: TranscriptSegment[], active: boolean): UseInsights {
  const insights = useMemo(() => {
    if (!active) return []
    return detectInsights(segments, {
      keywords: INSIGHTS.keywords,
      maxSurfaced: INSIGHTS.maxSurfaced
    })
  }, [segments, active])

  return { insights, firstInsight: insights[0] }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/hooks/useInsights.test.ts`
Expected: PASS, 4 cases green.

- [ ] **Step 6: Write the failing test for useSession**

Create `tests/renderer/hooks/useSession.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '../../../src/renderer/src/hooks/useSession'

beforeEach(() => {
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion: vi.fn(),
    askContextQuestion: vi.fn(),
    requestScreenshot: vi.fn(),
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    onTranscriptUpdate: vi.fn(() => () => {}),
    onTranscriptionStatus: vi.fn(() => () => {}),
    onSidecarStatus: vi.fn(() => () => {}),
    onScreenshot: vi.fn(() => () => {})
  }
})

describe('useSession', () => {
  it('starts inactive', () => {
    const { result } = renderHook(() => useSession())
    expect(result.current.active).toBe(false)
  })

  it('toggle starts a session and starts transcription capture', () => {
    const { result } = renderHook(() => useSession())
    act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
    expect(window.customcluely.startTranscription).toHaveBeenCalledOnce()
  })

  it('toggling twice ends the session and stops transcription capture', () => {
    const { result } = renderHook(() => useSession())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(window.customcluely.stopTranscription).toHaveBeenCalledOnce()
  })

  it('exposes the live transcript segments from the composed transcript hook', () => {
    const { result } = renderHook(() => useSession())
    expect(Array.isArray(result.current.segments)).toBe(true)
  })

  it('a fresh start after a stop makes the session active again', () => {
    const { result } = renderHook(() => useSession())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/hooks/useSession.test.ts`
Expected: FAIL with `Cannot find module '.../hooks/useSession'`.

- [ ] **Step 8: Write the useSession hook**

Create `src/renderer/src/hooks/useSession.ts`:

```typescript
import { useCallback, useState } from 'react'
import { useTranscript } from './useTranscript'
import {
  createSession,
  startSession,
  stopSession,
  insightsEnabled,
  type SessionState
} from '../../../main/session/session-manager'
import type { TranscriptSegment } from '../../../shared/types'

export interface UseSession {
  /** True while a meeting session is active. */
  active: boolean
  /** Starts a session when inactive, stops it when active. */
  toggle: () => void
  /** Live transcript segments from the composed useTranscript hook. */
  segments: TranscriptSegment[]
  /** True while the capture sidecar is down and being restarted. */
  audioPaused: boolean
}

// Composes the Phase 3/4 useTranscript capture hook with the pure session
// state machine. Starting a session both starts sidecar capture (which clears
// the main-process transcript) and moves the session to `active`, which is
// what gates insight detection. Stopping a session stops capture and freezes
// the session. The renderer's existing ListenToggle drives `toggle`; this
// hook supersedes the bare listen toggle conceptually while reusing the
// useTranscript plumbing unchanged.
export function useSession(): UseSession {
  const transcript = useTranscript()
  const [session, setSession] = useState<SessionState>(createSession)

  const toggle = useCallback(() => {
    setSession((current) => {
      if (insightsEnabled(current)) {
        transcript.stopListening()
        return stopSession(current)
      }
      transcript.startListening()
      return startSession(current)
    })
  }, [transcript])

  return {
    active: insightsEnabled(session),
    toggle,
    segments: transcript.segments,
    audioPaused: transcript.audioPaused
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/hooks/useSession.test.ts`
Expected: PASS, 5 cases green.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/insights/detect-insights.ts src/renderer/src/hooks/useInsights.ts src/renderer/src/hooks/useSession.ts tests/renderer/hooks/useInsights.test.ts tests/renderer/hooks/useSession.test.ts
git commit -m "feat: add useInsights and useSession renderer hooks"
```

---

## Task 13: useCodexAnswer context-ask and Electron main wiring (T5.1, T5.2, T5.3)

This task closes the typecheck-red note opened in Task 9 by giving `index.ts` the two new `IpcHandlerDeps` callbacks.

**Files:**
- Modify: `src/renderer/src/hooks/useCodexAnswer.ts`
- Modify: `src/main/index.ts`
- Test: `tests/renderer/hooks/useCodexAnswer.test.ts`

- [ ] **Step 1: Write the failing test for askContext**

Append this block to `tests/renderer/hooks/useCodexAnswer.test.ts` inside the existing top-level area (keep every existing import and case; the file already sets up `window.customcluely` in a `beforeEach`, so ensure that mock object includes `askContextQuestion: vi.fn()` and `requestScreenshot: vi.fn()` alongside the existing methods):

```typescript
describe('useCodexAnswer.askContext', () => {
  it('sends a context-ask request carrying the segments, screenshot flag, and extra args', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() =>
      result.current.askContext('recap please', [{ id: 's1', speaker: 'them', text: 'hello' }], {
        screenshot: true,
        extraArgs: ['--search']
      })
    )
    expect(window.customcluely.askContextQuestion).toHaveBeenCalledOnce()
    const sent = (window.customcluely.askContextQuestion as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(sent.question).toBe('recap please')
    expect(sent.segments).toHaveLength(1)
    expect(sent.screenshot).toBe(true)
    expect(sent.extraArgs).toEqual(['--search'])
  })

  it('shows the question as the active question and enters the streaming state', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.askContext('what next', [], { screenshot: false, extraArgs: [] }))
    expect(result.current.state.question).toBe('what next')
    expect(result.current.state.status).toBe('streaming')
  })

  it('ignores an empty context question', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.askContext('   ', [], { screenshot: false, extraArgs: [] }))
    expect(window.customcluely.askContextQuestion).not.toHaveBeenCalled()
  })
})
```

If `useCodexAnswer.test.ts` does not already define a full `window.customcluely` mock with the Phase 5 methods, update its `beforeEach` to add `askContextQuestion: vi.fn()` and `requestScreenshot: vi.fn()` to the mock object.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/hooks/useCodexAnswer.test.ts`
Expected: FAIL: `result.current.askContext` is not a function.

- [ ] **Step 3: Rewrite the useCodexAnswer hook**

Replace the entire contents of `src/renderer/src/hooks/useCodexAnswer.ts` with:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnswerChunk,
  AnswerResult,
  AnswerError,
  TranscriptSegment
} from '../../../shared/types'

export type CodexAnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface CodexAnswerState {
  status: CodexAnswerStatus
  question: string
  text: string
  error: string
}

/** Options for a transcript-and-screenshot-aware context query. */
export interface AskContextOptions {
  /** Attach the pending screenshot to the query. */
  screenshot: boolean
  /** Extra codex flags, for example `['--search']` for Fact check. */
  extraArgs: string[]
}

export interface UseCodexAnswer {
  state: CodexAnswerState
  /** Sends a plain question with no transcript or screenshot context. */
  ask: (question: string) => void
  /** Sends a question grounded in the transcript, optionally with a shot. */
  askContext: (
    question: string,
    segments: TranscriptSegment[],
    options: AskContextOptions
  ) => void
  retry: () => void
}

const INITIAL: CodexAnswerState = { status: 'idle', question: '', text: '', error: '' }

export function useCodexAnswer(): UseCodexAnswer {
  const [state, setState] = useState<CodexAnswerState>(INITIAL)
  const requestIdRef = useRef('')
  const lastQuestionRef = useRef('')

  useEffect(() => {
    const offChunk = window.customcluely.onAnswerChunk((chunk: AnswerChunk) => {
      if (chunk.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'streaming', text: s.text + chunk.delta }))
    })
    const offDone = window.customcluely.onAnswerDone((result: AnswerResult) => {
      if (result.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'done', text: result.text }))
    })
    const offError = window.customcluely.onAnswerError((error: AnswerError) => {
      if (error.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'error', error: error.message }))
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  const ask = useCallback((question: string) => {
    const trimmed = question.trim()
    if (trimmed.length === 0) return
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    lastQuestionRef.current = trimmed
    setState({ status: 'streaming', question: trimmed, text: '', error: '' })
    window.customcluely.askQuestion({ requestId, question: trimmed })
  }, [])

  const askContext = useCallback(
    (question: string, segments: TranscriptSegment[], options: AskContextOptions) => {
      const trimmed = question.trim()
      if (trimmed.length === 0) return
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      lastQuestionRef.current = trimmed
      setState({ status: 'streaming', question: trimmed, text: '', error: '' })
      window.customcluely.askContextQuestion({
        requestId,
        question: trimmed,
        segments,
        screenshot: options.screenshot,
        extraArgs: options.extraArgs
      })
    },
    []
  )

  const retry = useCallback(() => {
    if (lastQuestionRef.current.length > 0) ask(lastQuestionRef.current)
  }, [ask])

  return { state, ask, askContext, retry }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/hooks/useCodexAnswer.test.ts`
Expected: PASS, every existing case plus the three new `askContext` cases green.

- [ ] **Step 5: Wire the screenshot store and the new IPC callbacks into `src/main/index.ts`**

Make these surgical edits to `src/main/index.ts`. First, add two imports alongside the existing import block (after the `createSidecarSupervisor` import):

```typescript
import { createScreenshotStore } from './screenshots/screenshot-store'
import { writeFile as fsWriteFile, mkdir as fsMkdir, rm as fsRm } from 'node:fs/promises'
```

Then, immediately after the `const sidecar = createSidecarSupervisor({ ... })` block, add the screenshot store construction:

```typescript
  // Holds the single pending screenshot for the next Codex query. Screenshots
  // are written as PNG files into the Codex scratch dir so the runner can
  // attach them with `-i`; they are deleted once a query consumes them.
  const screenshotStore = createScreenshotStore({
    scratchRoot,
    writeFile: async (path, data) => {
      await fsMkdir(join(scratchRoot, 'screenshots'), { recursive: true })
      await fsWriteFile(path, data)
    },
    deleteFile: (path) => fsRm(path, { force: true })
  })
```

Then change the sidecar's `onScreenshot` callback so screenshots go into the store as well as to the renderer. Replace:

```typescript
    onScreenshot: (screenshot) => emitToOverlay(IpcChannel.Screenshot, screenshot),
```

with:

```typescript
    onScreenshot: (screenshot) => {
      void screenshotStore.save(screenshot)
      emitToOverlay(IpcChannel.Screenshot, screenshot)
    },
```

Then extend the `registerIpcHandlers` call. Replace the existing `registerIpcHandlers(ipcMain, { ... })` block with:

```typescript
  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request) => {
      void codexService.handleAsk(request)
    },
    // A transcript-and-screenshot-aware query. The pending screenshot (if any)
    // is consumed here so it is attached to exactly one query.
    onAskContextQuestion: (request) => {
      const screenshotPath = screenshotStore.consume()
      void codexService.handleContextAsk(request, screenshotPath)
    },
    // Starting a listening session resets the rolling audio state and starts
    // the Swift sidecar capturing system audio and the microphone.
    onStartTranscription: () => {
      transcriptionService.reset()
      sidecar.start()
    },
    // Stopping clears the rolling state. The sidecar keeps running so a
    // restart is fast; it is fully shut down only on app quit.
    onStopTranscription: () => {
      transcriptionService.reset()
    },
    // The renderer asked for a screenshot: forward the request to the sidecar.
    // The sidecar's screenshot event lands in screenshotStore via onScreenshot.
    onRequestScreenshot: () => {
      sidecar.requestScreenshot()
    }
  })
```

- [ ] **Step 6: Typecheck (closes the Task 9 typecheck-red note)**

Run: `npm run typecheck`
Expected: PASS, no type errors. `index.ts` now supplies all six `IpcHandlerDeps` callbacks.

- [ ] **Step 7: Run the full test suite**

Run: `npm run test`
Expected: PASS, every test file green.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/hooks/useCodexAnswer.ts src/main/index.ts tests/renderer/hooks/useCodexAnswer.test.ts
git commit -m "feat: wire context-ask and screenshot store through the renderer and main"
```

---

## Task 14: Compose Phase 5 into App.tsx with the Tab and screenshot hotkeys (T5.2, T5.3, T5.4, T5.5)

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/renderer/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/renderer/App.test.tsx` with this version (it keeps the original assertions and adds Phase 5 coverage; the bridge mock is updated to the Phase 5 surface):

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'
import type { TranscriptUpdatePayload } from '../../src/shared/types'

let askQuestion: ReturnType<typeof vi.fn>
let askContextQuestion: ReturnType<typeof vi.fn>
let requestScreenshot: ReturnType<typeof vi.fn>
let startTranscription: ReturnType<typeof vi.fn>
let transcriptUpdateCb: (p: TranscriptUpdatePayload) => void

beforeEach(() => {
  askQuestion = vi.fn()
  askContextQuestion = vi.fn()
  requestScreenshot = vi.fn()
  startTranscription = vi.fn()
  transcriptUpdateCb = () => {}
  window.customcluely = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion,
    askContextQuestion,
    requestScreenshot,
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
    startTranscription,
    stopTranscription: vi.fn(),
    onTranscriptUpdate: vi.fn((cb) => {
      transcriptUpdateCb = cb
      return () => {}
    }),
    onTranscriptionStatus: vi.fn(() => () => {}),
    onSidecarStatus: vi.fn(() => () => {}),
    onScreenshot: vi.fn(() => () => {})
  }
})

describe('App', () => {
  it('renders the command bar and the empty answer panel', () => {
    render(<App />)
    expect(screen.getByLabelText('Question input')).toBeInTheDocument()
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('submitting a question calls askQuestion and shows the active question', async () => {
    render(<App />)
    const input = screen.getByLabelText('Question input')
    await userEvent.type(input, 'What is a closure?')
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    expect(askQuestion).toHaveBeenCalledOnce()
    expect(screen.getByText('What is a closure?')).toBeInTheDocument()
  })

  it('renders the five Default Action buttons', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Recap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fact check' })).toBeInTheDocument()
  })

  it('clicking a Default Action sends a context-ask query', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Recap' }))
    expect(askContextQuestion).toHaveBeenCalledOnce()
    const sent = askContextQuestion.mock.calls[0][0]
    expect(sent.question.toLowerCase()).toContain('recap')
  })

  it('the Fact check Default Action sends --search in extraArgs', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Fact check' }))
    const sent = askContextQuestion.mock.calls[0][0]
    expect(sent.extraArgs).toContain('--search')
  })

  it('clicking the screenshot button requests a screenshot from the sidecar', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /screenshot/i }))
    expect(requestScreenshot).toHaveBeenCalledOnce()
  })

  it('starting a session starts transcription and reveals detected insights', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /start listening/i }))
    expect(startTranscription).toHaveBeenCalledOnce()
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    expect(await screen.findByText('when do we ship?')).toBeInTheDocument()
  })

  it('does not show insights before a session is started', () => {
    render(<App />)
    act(() => {
      transcriptUpdateCb({ segments: [{ id: 's1', speaker: 'them', text: 'when do we ship?' }] })
    })
    // The transcript panel still renders the line, but the insight surface does
    // not: only the transcript-panel copy of the text exists, not an insight button.
    expect(screen.queryByRole('button', { name: /question.*when do we ship/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/renderer/App.test.tsx`
Expected: FAIL: there is no Default Action button, no screenshot button, and the insight surface is not wired.

- [ ] **Step 3: Rewrite `App.tsx`**

Replace the entire contents of `src/renderer/src/App.tsx` with:

```typescript
import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { ListenToggle } from './components/ListenToggle'
import { SetupBanner } from './components/SetupBanner'
import { DefaultActions } from './components/DefaultActions'
import { InsightList } from './components/InsightList'
import { useCodexAnswer } from './hooks/useCodexAnswer'
import { useSession } from './hooks/useSession'
import { useInsights } from './hooks/useInsights'
import { findDefaultAction } from '../../main/codex/default-actions'
import type { Insight } from './insights/detect-insights'
import type { OverlayState, CodexStatus, DefaultActionId } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, askContext, retry } = useCodexAnswer()
  const { active, toggle, segments, audioPaused } = useSession()
  const { insights, firstInsight } = useInsights(segments, active)

  const busy = state.status === 'streaming'

  useEffect(() => {
    const offState = window.customcluely.onOverlayState((overlay: OverlayState) => {
      setInvisible(overlay.invisible)
    })
    const offStatus = window.customcluely.onCodexStatus((status: CodexStatus) => {
      setSetupMessage(status.available && status.authenticated ? null : status.detail)
    })
    return () => {
      offState()
      offStatus()
    }
  }, [])

  // Runs a Default Action: its preset prompt and codex-arg modifiers are fed
  // to the transcript-aware context-ask path.
  function runDefaultAction(id: DefaultActionId): void {
    const action = findDefaultAction(id)
    if (!action) return
    askContext(action.promptTemplate, segments, {
      screenshot: false,
      extraArgs: [...action.extraArgs]
    })
  }

  // Answers one dynamic insight via the context-ask path.
  function answerInsight(insight: Insight): void {
    askContext(insight.label, segments, { screenshot: false, extraArgs: [] })
  }

  // Renderer-local hotkeys (design spec section 13). Tab answers the first
  // dynamic insight; Cmd+Shift+S captures a screenshot. Tab is ignored while
  // a text input or textarea is focused so normal typing still works.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (event.key === 'Tab' && !typing) {
        if (firstInsight && !busy) {
          event.preventDefault()
          answerInsight(firstInsight)
        }
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        window.customcluely.requestScreenshot()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="app">
      <SetupBanner message={setupMessage} />
      {audioPaused && (
        <p className="app__audio-paused" role="status">
          Audio paused, reconnecting capture...
        </p>
      )}
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={busy} />
        <button
          className="command-bar__screenshot"
          aria-label="Capture screenshot"
          onClick={() => window.customcluely.requestScreenshot()}
        >
          Screenshot
        </button>
        <ListenToggle listening={active} onToggle={toggle} />
        <EyeToggle invisible={invisible} onToggle={() => window.customcluely.toggleInvisibility()} />
      </div>
      <DefaultActions onAction={runDefaultAction} disabled={busy} />
      {active && <InsightList insights={insights} onAnswer={answerInsight} disabled={busy} />}
      {state.question.length > 0 && <p className="app__active-question">{state.question}</p>}
      <AnswerPanel answer={state.text} status={state.status} error={state.error} onRetry={retry} />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/renderer/App.test.tsx`
Expected: PASS, all 8 cases green.

- [ ] **Step 5: Run the full suite, typecheck, lint, and build**

Run: `npm run test`
Expected: PASS, every test file green.

Run: `npm run typecheck`
Expected: PASS, no type errors in the node or web projects.

Run: `npm run lint`
Expected: exit 0 (prettier formatting warnings are allowed; no errors).

Run: `npm run build`
Expected: electron-vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx tests/renderer/App.test.tsx
git commit -m "feat: compose Default Actions, insights, sessions, and hotkeys into the overlay"
```

---

## Task 15: Phase 5 verification (T5.6)

**Files:**
- Create: `docs/superpowers/verification/2026-05-20-phase-5.md`

- [ ] **Step 1: Write the verification document**

Create `docs/superpowers/verification/2026-05-20-phase-5.md`:

```markdown
# Phase 5 Verification: Context Intelligence

**Phase goal:** The full Live Insights experience: rolling transcript summary, screenshot context, Default Actions, dynamic insights, and explicit sessions.
**Acceptance:** A full meeting flow works: start a session, listen, have a question detected as an insight, and answer it using the rolling transcript and an optional screenshot.

## Automated checks

Run each command from the repository root. All must pass.

| # | Command | Expected |
|---|---------|----------|
| 1 | `npm run test` | All test files pass, including `tests/main/codex/transcript-context.test.ts`, `tests/main/codex/default-actions.test.ts`, the updated `tests/main/codex/prompt-builder.test.ts`, `codex-args.test.ts`, `codex-service.test.ts`, `tests/main/insights/insight-detector.test.ts`, `tests/main/session/session-manager.test.ts`, `tests/main/screenshots/screenshot-store.test.ts`, the updated `tests/main/ipc/ipc-handlers.test.ts`, `tests/preload/api.test.ts`, `tests/renderer/components/DefaultActions.test.tsx`, `tests/renderer/components/InsightList.test.tsx`, `tests/renderer/hooks/useInsights.test.ts`, `tests/renderer/hooks/useSession.test.ts`, and `tests/renderer/App.test.tsx`. |
| 2 | `npm run typecheck` | No type errors in the node or web projects. |
| 3 | `npm run lint` | Exit 0 (prettier formatting warnings allowed, no errors). |
| 4 | `npm run build` | electron-vite build succeeds. |

## Automated check results

Executed from the repository root on 2026-05-22 on branch `build/phase-5-context`. Record the real observed outcome of each command here when the phase is executed.

| # | Command | Result | Observed outcome |
|---|---------|--------|------------------|
| 1 | `npm run test` | (record) | (record vitest file/test counts) |
| 2 | `npm run typecheck` | (record) | (record) |
| 3 | `npm run lint` | (record) | (record warning count and exit code) |
| 4 | `npm run build` | (record) | (record) |

## T5.x roadmap coverage

| Roadmap item | Implemented by |
|---|---|
| T5.1 Rolling transcript summarizer | Task 1 (`CONTEXT` constants), Task 3 (`transcript-context.ts`, the pure char-budgeted summarizer, and the transcript-aware `prompt-builder.ts`), Task 4 (`codex-service.ts` `handleContextAsk` builds the bounded context). |
| T5.2 Screenshot context attachment | Task 1 (`RequestScreenshot` channel), Task 2 (`codex-args.ts` `-i` image flag), Task 8 (`screenshot-store.ts`), Task 9 (`RequestScreenshot` IPC handler), Task 10 (`requestScreenshot` preload method), Task 13 (`index.ts` routes sidecar screenshots into the store and consumes the pending screenshot per query), Task 14 (the screenshot button and `Cmd+Shift+S` hotkey). |
| T5.3 Default Actions | Task 1 (`DefaultActionId` type), Task 2 (`codex-args.ts` `extraArgs` for `--search`), Task 5 (`default-actions.ts` preset table), Task 11 (`DefaultActions.tsx`), Task 14 (`App.tsx` `runDefaultAction` feeds the context-ask path). |
| T5.4 Dynamic insight detector | Task 1 (`INSIGHTS` constants), Task 6 (`insight-detector.ts`, the pure rule-based detector), Task 11 (`InsightList.tsx`), Task 12 (`useInsights.ts`), Task 14 (`App.tsx` renders the insight surface and binds `Tab` to answer the first insight). |
| T5.5 Session manager | Task 7 (`session-manager.ts`, the pure state machine), Task 12 (`useSession.ts` composes `useTranscript`), Task 14 (`App.tsx` feeds `ListenToggle` from the session and gates the insight surface on `active`). |
| T5.6 Phase 5 verification | This document. |

## Key decisions (recorded in the plan)

- **Summarizer:** pure heuristic char-budgeted compaction, no background Codex call. Recent segments verbatim plus a digest of older segments.
- **Session vs ListenToggle:** the session manager supersedes the bare listen toggle conceptually but reuses the `ListenToggle` component and the `useTranscript` capture plumbing unchanged; `useSession` composes `useTranscript`.
- **Insight heuristic:** pure rule-based. Questions = trailing `?` or interrogative opener; keywords = a curated salient-term list. No model.
- **Screenshot location:** PNGs written to `<userData>/.codex-scratch/screenshots/`, attached via `-i`, deleted by the Codex runner after the query completes.

## Manual checklist

Perform these on macOS arm64 with a working microphone, the codex CLI authenticated (`codex login`), the whisper model downloaded, and the sidecar built (`bash scripts/setup-sidecar.sh`).

- [ ] Run `npm run dev`. Confirm the overlay shows the command bar, the five Default Action buttons, the Screenshot button, and the "Start listening" toggle.
- [ ] Confirm NO dynamic insights are shown before a session is started.
- [ ] Click "Start listening". Confirm the toggle reads "Stop listening" and a session is active.
- [ ] Speak a clear question such as "what is the deadline for this project?" Confirm a transcript line appears and, within a few seconds, an insight row appears below the command bar labelled as a question.
- [ ] Press `Tab` (with no text input focused). Confirm the first insight is answered: the answer panel streams a Codex answer grounded in the transcript.
- [ ] Type a custom question in the command bar and submit with the Ask button. Confirm a plain answer streams in.
- [ ] Click each of the five Default Actions ("What should I say next", "Follow-up questions", "Fact check", "Recap", "Coding help"). Confirm each streams an answer that reflects the meeting transcript. Confirm "Fact check" still answers (it runs with `--search`).
- [ ] Click the "Screenshot" button (or press `Cmd+Shift+S`). Then run a Default Action or ask a question and confirm the answer can reference on-screen content. Confirm the screenshot does NOT contain the Customcluely overlay window (the Phase 4 exclusion still holds).
- [ ] Let the meeting run long enough to produce more than a dozen transcript segments. Confirm answers stay fast and relevant (the rolling summarizer keeps the prompt bounded; older content is compacted, recent content is verbatim).
- [ ] Click "Stop listening". Confirm the session ends, the insight surface disappears, and the transcript freezes (no new lines while you keep speaking).
- [ ] Click "Start listening" again. Confirm a fresh session starts with an empty transcript and no stale insights from the previous session.
- [ ] **No-API-key check:** confirm the app never asked for and never stored an OpenAI API key; all answers came from the local `codex` CLI.

## Sign-off

Phase 5 is complete when every automated check passes and every manual
checklist item is confirmed, in particular the acceptance flow: start a
session, listen, have a question detected as an insight, and answer it using
the rolling transcript and an optional screenshot.
```

- [ ] **Step 2: Run all automated checks listed in the doc**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: every command exits 0. Record the observed outcomes in the "Automated check results" table of the verification doc, then save the doc.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/verification/2026-05-20-phase-5.md
git commit -m "docs: add Phase 5 context intelligence verification"
```

---

## Self-review

This plan has **15 tasks**.

**1. Spec and roadmap coverage.** Every Phase 5 roadmap item (T5.1 to T5.6) maps to at least one task:

- **T5.1 Rolling transcript summarizer:** Task 1 adds the `CONTEXT` constants (recent-segment count, older-segment char budget, marker). Task 3 implements `transcript-context.ts`, a pure, deterministic, char-budgeted summarizer with no Codex call (recent segments verbatim plus a budgeted digest of older segments), unit-tested with 6 cases, and rewrites `prompt-builder.ts` to be transcript-aware. Task 4's `codex-service.ts` `handleContextAsk` calls `buildTranscriptContext` so every context query carries the bounded transcript. The decision (heuristic, not a Codex call) is recorded with its rationale.
- **T5.2 Screenshot context attachment:** Task 2 adds the `-i` image flag to `codex-args.ts`. Task 8 implements `screenshot-store.ts`, which decodes the sidecar's base64 PNG to a file in the Codex scratch dir and holds one pending screenshot; its `consume()` returns the path and clears the pending slot without deleting the file, and the Codex runner deletes the file in its `finally` block after the query. Task 9 adds the `RequestScreenshot` IPC channel; Task 10 adds the `requestScreenshot` preload method; Task 13 routes the Phase 4 sidecar `onScreenshot` event into the store and consumes the pending screenshot per context query (passing the path to `handleContextAsk`); Task 14 adds the visible Screenshot button and the `Cmd+Shift+S` hotkey. The normal text-query path still works: `handleAsk` is untouched and `handleContextAsk` falls back to a plain query when `screenshot` is false or no path is pending (covered by a `codex-service` test case).
- **T5.3 Default Actions:** Task 5 implements `default-actions.ts`, the pure preset table of the five spec actions ("What should I say next", "Follow-up questions", "Fact check", "Recap", "Coding help (Smart Mode)"), each with an id, label, prompt template, and codex-arg modifiers; only `fact-check` carries `--search`. Task 2 adds `extraArgs` to `codex-args.ts` so `--search` flows through. Task 11 builds the `DefaultActions.tsx` row of black-and-white buttons. Task 14 wires each button to the context-ask path. Unit-tested in Task 5 (6 cases) and Task 11 (4 cases).
- **T5.4 Dynamic insight detector:** Task 1 adds the `INSIGHTS` constants. Task 6 implements `insight-detector.ts`, a pure rule-based, fully deterministic detector (questions = trailing `?` or interrogative opener; keywords = curated list), unit-tested with 13 cases. Task 11 builds `InsightList.tsx`; Task 12 builds `useInsights.ts`; Task 14 renders the surface below the command bar and binds `Tab` to answer the first insight. The `Tab` hotkey is renderer-local (pinned fact 6).
- **T5.5 Session manager:** Task 7 implements `session-manager.ts`, a pure immutable state machine (`idle`/`active`/`ended`), unit-tested with 11 cases. Task 12's `useSession.ts` composes `useTranscript` so a session start also starts capture and a stop also stops it. Task 14 feeds `ListenToggle` from the session and gates the insight surface on `active`. The decision section states explicitly how the session manager reconciles with `ListenToggle`: it supersedes the bare toggle conceptually while reusing the `ListenToggle` component and the `useTranscript` plumbing unchanged.
- **T5.6 Phase 5 verification:** Task 15 creates the verification doc with 4 automated checks, the recorded-results table, the T5.x coverage table, the key-decisions summary, and a full end-to-end manual checklist that covers listening, detecting a question, answering it via the transcript and an optional screenshot, all five Default Actions, and session start/stop.

Scope is not expanded beyond Phase 5: there is no `exec resume --last` and no `--output-schema` (pinned fact 5 records that they are deferred per spec section 9), no `codex app-server` integration, and no new sidecar Swift code (the Phase 4 screenshot path is reused).

**2. Placeholder scan.** No `TODO`, `TBD`, `implement later`, `add error handling`, `similar to Task N`, or bare "write tests" placeholders. Every code step contains the complete file contents or a fully specified surgical edit with the exact text to replace and the exact replacement. Task 13's `index.ts` edits are given as exact replace-this-with-that blocks, not "wire it up". The verification doc's "Automated check results" table has explicit `(record)` markers because those values can only be observed at execution time; this is an instruction to record real output, not a placeholder for missing code.

**3. Type and name consistency across tasks.**

- `IpcChannel` keys `AskContextQuestion` (`'codex:ask-context'`) and `RequestScreenshot` (`'sidecar:request-screenshot'`) defined in Task 1 are used identically in Task 9 (`ipc-handlers.ts`), Task 10 (`api.ts`), and the Task 9/10 tests.
- `ContextAskRequest` (`requestId`, `question`, `segments`, `screenshot`, `extraArgs`) defined in Task 1 is the payload type for `askContextQuestion` (Task 10 preload), is built by `useCodexAnswer.askContext` (Task 13), is validated by `validateContextRequest` in `codex-service.ts` (Task 4), and is the shape asserted in the Task 4, Task 10, and Task 13 tests. The five field names match everywhere.
- `DefaultActionId` (`'say-next' | 'follow-up' | 'fact-check' | 'recap' | 'coding-help'`) defined in Task 1 is the `id` type of `DefaultAction` in `default-actions.ts` (Task 5) and the parameter type of `DefaultActions.onAction` (Task 11) and `App.runDefaultAction` (Task 14). The Task 5 test asserts exactly this id list and order.
- `CONTEXT` fields (`recentSegments`, `olderCharBudget`, `olderMarker`) defined in Task 1 are consumed by `buildTranscriptContext` via `TranscriptContextOptions` (Task 3) and passed by `codex-service.ts` (Task 4); the field names match the `TranscriptContextOptions` interface.
- `INSIGHTS` fields (`maxSurfaced`, `keywords`) defined in Task 1 are consumed by `detectInsights` via `DetectInsightsOptions` (Task 6) and passed by `useInsights` (Task 12); names match.
- `buildPrompt(question, transcriptContext)` (Task 3, two args) is called with two args by `codex-service.ts` `handleAsk` (`buildPrompt(q, '')`) and `handleContextAsk` (`buildPrompt(q, context)`) in Task 4. The one-arg-to-two-arg change is the documented typecheck-red window, closed in Task 4.
- `buildCodexArgs` input gains optional `imagePath` and `extraArgs` (Task 2); `codex-service.ts` `runQuery` passes exactly those field names (Task 4); the Task 2 test asserts `-i <path>` and `--search` placement before the prompt.
- `createCodexService` returns `{ handleAsk, handleContextAsk }` (Task 4); `index.ts` calls `codexService.handleAsk` and `codexService.handleContextAsk` (Task 13) with matching names. `handleContextAsk(request, screenshotPath?)` matches the Task 13 call `handleContextAsk(request, screenshotPath)`.
- `Insight` (`id`, `kind`, `sourceSegmentId`, `label`) defined in Task 6 is consumed by `InsightList` (Task 11), `useInsights` (Task 12), and `App.answerInsight` (Task 14) with matching field names; the renderer imports it via the `detect-insights.ts` re-export (Task 12).
- `detectInsights(segments, options)` (Task 6) is called with that signature by `useInsights` (Task 12).
- `SessionState` and `createSession`/`startSession`/`stopSession`/`insightsEnabled` (Task 7) are used with those exact names by `useSession` (Task 12).
- `useSession` returns `{ active, toggle, segments, audioPaused }` (Task 12); `App.tsx` (Task 14) destructures exactly those four.
- `useInsights(segments, active)` returns `{ insights, firstInsight }` (Task 12); `App.tsx` (Task 14) destructures exactly those two and binds `Tab` to `firstInsight`.
- `useCodexAnswer` returns `{ state, ask, askContext, retry }` (Task 13); `App.tsx` (Task 14) destructures exactly those four. `askContext(question, segments, options)` with `AskContextOptions = { screenshot, extraArgs }` (Task 13) matches the Task 14 call sites in `runDefaultAction` and `answerInsight`.
- `ScreenshotStore` returns `{ save, pendingPath, consume }` (Task 8); `index.ts` calls `screenshotStore.save` (in `onScreenshot`) and `screenshotStore.consume` (in `onAskContextQuestion`) in Task 13.
- `createScreenshotStore` deps (`scratchRoot`, `writeFile`, `deleteFile`) defined in Task 8 are supplied exactly by `index.ts` in Task 13.
- `IpcHandlerDeps` gains `onAskContextQuestion` and `onRequestScreenshot` (Task 9, six callbacks total); `index.ts` supplies exactly six callbacks (Task 13); the Task 9 test asserts exactly six channel registrations.
- `DefaultActions` props `{ onAction, disabled }` and `InsightList` props `{ insights, onAnswer, disabled }` (Task 11) match the `App.tsx` usage (Task 14).
- `ListenToggle` keeps its existing `{ listening, onToggle }` props; `App.tsx` passes `listening={active}` and `onToggle={toggle}` (Task 14), consistent with the Phase 3/4 component, which is not modified.

**4. Typecheck-red window.** One window, fully documented: Task 3 changes `buildPrompt` to two arguments, breaking `codex-service.ts` until Task 4 rewrites it; Task 9 changes `IpcHandlerDeps` to six callbacks, breaking `index.ts` until Task 13 supplies them. Both breaks are called out in the task steps (Task 3 Step 6, Task 9 Step 4) and both are closed with an explicit `npm run typecheck` PASS gate (Task 4 Step 5, Task 13 Step 6). No other task leaves the tree red.

**5. Em dash scan.** The full plan text, every prose line, every code block, and every comment was scanned for the em dash character (U+2014). None is present. Only commas, periods, parentheses, colons, semicolons, and plain hyphens are used.

No inconsistencies found. The plan is internally consistent across all 15 tasks and ready for execution.
