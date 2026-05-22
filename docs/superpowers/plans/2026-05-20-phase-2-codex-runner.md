# Phase 2: Codex Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per project memory, every task runs the 3-agent pipeline (implementer, auditor, documenter) and every spawned agent uses the Opus model.

**Goal:** Make the overlay answer questions by spawning the local `codex exec` CLI per query, streaming its JSONL output progressively into the answer panel, with no OpenAI API key in the app.

**Architecture:** The renderer's `CommandBar` submit calls a preload `askQuestion` over IPC. The main process runs `codex exec --json` in a subprocess against an empty scratch directory, parses the JSONL event stream for agent-message text, and emits answer chunks back to the renderer. The clean final answer is read from `codex`'s `-o` output file, which is the source of truth; the JSONL stream is used only for progressive streaming. Pure logic (arg builder, JSONL parser, prompt builder, line splitter, answer accumulator, availability check) lives in files importing only TypeScript types and is fully unit-tested. The subprocess runner is tested end-to-end against a mock `codex` binary written in Node. Electron glue (main wiring, preload) is verified by typecheck and build.

**Tech Stack:** Electron, TypeScript, React 19, electron-vite, Vitest, the `codex` CLI 0.125.0 (installed at `/opt/homebrew/bin/codex`).

---

## Context: what Phase 1 already provides

These exist and must not be broken. New code extends them.

- `src/shared/types.ts` - `IpcChannel` const object (`ToggleInvisibility`, `OverlayState`), `HotkeyAction`, `OverlayState`, `TranscriptSegment`.
- `src/main/ipc/ipc-handlers.ts` - `registerIpcHandlers(ipcMain, deps)` with `IpcMainLike`, `IpcHandlerDeps { onToggleInvisibility }`.
- `src/preload/api.ts` - `createOverlayApi(ipcRenderer)` returning `OverlayApi { toggleInvisibility, onOverlayState }`; has a private `subscribe<T>()` helper.
- `src/preload/index.d.ts` - declares `Window.whisperglass: OverlayApi`.
- `src/renderer/src/components/CommandBar.tsx` - props `{ onSubmit: (question: string) => void; disabled?: boolean }`.
- `src/renderer/src/components/AnswerPanel.tsx` - prop `{ answer: string }`.
- `src/renderer/src/App.tsx` - holds `activeQuestion` state, renders `CommandBar`, `AnswerPanel answer=""`, `SetupBanner message={null}`.
- `src/main/index.ts` - creates the overlay window, `pushState()`, `registerIpcHandlers`, hotkeys.
- `src/main/config/constants.ts` - `OVERLAY`, `MOVE_STEP_PX`, `GLOBAL_HOTKEYS`.

**Verified `codex exec` interface (0.125.0):**
- `codex exec [OPTIONS] [PROMPT]` - prompt is the trailing argument.
- `--json` - prints events to stdout as JSONL.
- `-o, --output-last-message <FILE>` - writes the agent's final message to a file.
- `--ephemeral` - no session files on disk. `--skip-git-repo-check` - allow running outside a git repo.
- `-s read-only` - sandbox: no file writes. `-C <DIR>` - working root. `-c key=value` - config override. `-m <MODEL>`.
- There is no `-a` flag on `codex exec`; the spec's mention of `-a never` is dropped (exec is already non-interactive).

**Test conventions (from Phase 1):**
- Vitest, no globals: every test file starts `import { describe, it, expect, vi } from 'vitest'`.
- `vitest.config.ts` sets `environment: 'node'`. Renderer tests that need a DOM put `// @vitest-environment jsdom` as the first line.
- `tests/setup.ts` already registers `@testing-library/jest-dom/vitest` and an `afterEach(cleanup)`.
- Test files mirror `src/` paths under `tests/`.
- Components use `React.JSX.Element` (bare `JSX.Element` does not resolve under React 19).

## File structure for Phase 2

| File | Responsibility |
|---|---|
| `src/shared/types.ts` (modify) | Add Codex IPC channels and request/response types |
| `src/main/config/constants.ts` (modify) | Add `CODEX` config block |
| `src/main/codex/availability.ts` (create) | Pure: decide Codex availability/auth from injected probes |
| `src/main/codex/prompt-builder.ts` (create) | Pure: assemble the system instruction + question prompt |
| `src/main/codex/event-parser.ts` (create) | Pure: parse one JSONL line into a `CodexEvent` |
| `src/main/codex/line-splitter.ts` (create) | Pure: split a stream buffer into complete lines |
| `src/main/codex/answer-accumulator.ts` (create) | Pure: turn cumulative agent text into deltas |
| `src/main/codex/codex-args.ts` (create) | Pure: build the `codex exec` argv array |
| `src/main/codex/codex-runner.ts` (create) | Spawn `codex exec`, stream events, resolve a result |
| `src/main/codex/codex-service.ts` (create) | Glue: wire a question to the runner and emit IPC events |
| `src/main/ipc/ipc-handlers.ts` (modify) | Add the `AskQuestion` channel handler |
| `src/preload/api.ts` (modify) | Add `askQuestion` and answer/status subscriptions |
| `src/main/index.ts` (modify) | Construct the Codex service, push Codex status, register the handler |
| `src/renderer/src/hooks/useCodexAnswer.ts` (create) | Renderer hook: own answer state + IPC subscriptions |
| `src/renderer/src/components/AnswerPanel.tsx` (modify) | Render idle / thinking / streaming / error states |
| `src/renderer/src/App.tsx` (modify) | Wire `CommandBar` -> `useCodexAnswer` -> `AnswerPanel` + `SetupBanner` |
| `tests/fixtures/codex/*` (create) | Mock `codex` binaries and a sample JSONL stream |

---

## Task 1: Codex shared contract (types and IPC channels)

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/shared/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { IpcChannel } from '../../src/shared/types'

describe('IpcChannel', () => {
  it('keeps the Phase 1 overlay channels', () => {
    expect(IpcChannel.ToggleInvisibility).toBe('overlay:toggle-invisibility')
    expect(IpcChannel.OverlayState).toBe('overlay:state')
  })

  it('adds the Codex channels with namespaced values', () => {
    expect(IpcChannel.AskQuestion).toBe('codex:ask')
    expect(IpcChannel.AnswerChunk).toBe('codex:answer-chunk')
    expect(IpcChannel.AnswerDone).toBe('codex:answer-done')
    expect(IpcChannel.AnswerError).toBe('codex:answer-error')
    expect(IpcChannel.CodexStatus).toBe('codex:status')
  })

  it('uses a unique string per channel', () => {
    const values = Object.values(IpcChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shared/types.test.ts`
Expected: FAIL - `IpcChannel.AskQuestion` is `undefined`.

- [ ] **Step 3: Add the channels and types**

In `src/shared/types.ts`, replace the `IpcChannel` const with:

```ts
export const IpcChannel = {
  ToggleInvisibility: 'overlay:toggle-invisibility',
  OverlayState: 'overlay:state',
  AskQuestion: 'codex:ask',
  AnswerChunk: 'codex:answer-chunk',
  AnswerDone: 'codex:answer-done',
  AnswerError: 'codex:answer-error',
  CodexStatus: 'codex:status',
} as const
```

Then append, after `TranscriptSegment`:

```ts
export interface CodexStatus {
  available: boolean
  authenticated: boolean
  detail: string
}

export interface AskQuestionRequest {
  requestId: string
  question: string
}

export interface AnswerChunk {
  requestId: string
  delta: string
}

export interface AnswerResult {
  requestId: string
  text: string
}

export interface AnswerError {
  requestId: string
  message: string
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shared/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat: add Codex IPC channels and request/response types"
```

---

## Task 2: Codex availability check

Decides whether Codex can be used, from two injected probes. Pure and fully unit-tested; the real probes are wired in Task 9.

**Files:**
- Create: `src/main/codex/availability.ts`
- Test: `tests/main/codex/availability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/codex/availability.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkCodexAvailability } from '../../../src/main/codex/availability'

describe('checkCodexAvailability', () => {
  it('reports unavailable when the binary is missing', async () => {
    const status = await checkCodexAvailability({
      getVersion: async () => null,
      authFileExists: () => false,
    })
    expect(status.available).toBe(false)
    expect(status.authenticated).toBe(false)
    expect(status.detail).toContain('not found')
  })

  it('reports available but unauthenticated when there is no auth file', async () => {
    const status = await checkCodexAvailability({
      getVersion: async () => 'codex-cli 0.125.0',
      authFileExists: () => false,
    })
    expect(status.available).toBe(true)
    expect(status.authenticated).toBe(false)
    expect(status.detail).toContain('codex login')
  })

  it('reports ready when the binary and auth file are both present', async () => {
    const status = await checkCodexAvailability({
      getVersion: async () => 'codex-cli 0.125.0',
      authFileExists: () => true,
    })
    expect(status.available).toBe(true)
    expect(status.authenticated).toBe(true)
    expect(status.detail).toContain('0.125.0')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/availability.test.ts`
Expected: FAIL - cannot resolve `../../../src/main/codex/availability`.

- [ ] **Step 3: Write the implementation**

Create `src/main/codex/availability.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/availability.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/main/codex/availability.ts tests/main/codex/availability.test.ts
git commit -m "feat: add Codex availability check"
```

---

## Task 3: Prompt builder

**Files:**
- Create: `src/main/codex/prompt-builder.ts`
- Test: `tests/main/codex/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/codex/prompt-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../../../src/main/codex/prompt-builder'

describe('buildPrompt', () => {
  it('includes the meeting-copilot system instruction', () => {
    const prompt = buildPrompt('What is a closure?')
    expect(prompt.toLowerCase()).toContain('meeting copilot')
    expect(prompt.toLowerCase()).toContain('concise')
  })

  it('includes the question under a Question label', () => {
    expect(buildPrompt('What is a closure?')).toContain('Question: What is a closure?')
  })

  it('trims surrounding whitespace from the question', () => {
    expect(buildPrompt('  hello  ')).toContain('Question: hello')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/prompt-builder.test.ts`
Expected: FAIL - cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `src/main/codex/prompt-builder.ts`:

```ts
const SYSTEM_INSTRUCTION = [
  'You are a real-time meeting copilot.',
  'Answer the question directly and concisely in plain text.',
  'No markdown, no headings, no preamble - a few sentences at most.',
  'If the question is ambiguous, give the most useful brief answer anyway.',
].join(' ')

export function buildPrompt(question: string): string {
  return `${SYSTEM_INSTRUCTION}\n\nQuestion: ${question.trim()}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/prompt-builder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/main/codex/prompt-builder.ts tests/main/codex/prompt-builder.test.ts
git commit -m "feat: add Codex prompt builder"
```

---

## Task 4: Codex JSONL event parser

Parses one line of `codex exec --json` output into a tagged `CodexEvent`. The parser is deliberately defensive: any line it does not recognize becomes `{ kind: 'ignored' }`, so an unexpected event shape can never crash the runner.

**Files:**
- Create: `src/main/codex/event-parser.ts`
- Create: `tests/fixtures/codex/sample-stream.jsonl`
- Test: `tests/main/codex/event-parser.test.ts`

- [ ] **Step 1: Create the sample fixture**

Create `tests/fixtures/codex/sample-stream.jsonl` (one JSON object per line, no trailing blank line):

```
{"type":"thread.started","thread_id":"t-1"}
{"type":"turn.started"}
{"type":"item.updated","item":{"id":"i-1","item_type":"agent_message","text":"A closure is"}}
{"type":"item.completed","item":{"id":"i-1","item_type":"agent_message","text":"A closure is a function bundled with its surrounding state."}}
{"type":"turn.completed","usage":{"input_tokens":40,"output_tokens":12}}
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/codex/event-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexLine } from '../../../src/main/codex/event-parser'

describe('parseCodexLine', () => {
  it('ignores blank lines', () => {
    expect(parseCodexLine('   ')).toEqual({ kind: 'ignored' })
  })

  it('ignores non-JSON lines', () => {
    expect(parseCodexLine('not json')).toEqual({ kind: 'ignored' })
  })

  it('ignores lifecycle events with no answer text', () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t-1"}')).toEqual({ kind: 'ignored' })
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual({ kind: 'ignored' })
  })

  it('extracts agent-message text from item events', () => {
    const line = '{"type":"item.updated","item":{"item_type":"agent_message","text":"hello"}}'
    expect(parseCodexLine(line)).toEqual({ kind: 'agent-text', text: 'hello' })
  })

  it('extracts agent text when content is an array of parts', () => {
    const line =
      '{"type":"item.completed","item":{"item_type":"agent_message","content":[{"text":"a "},{"text":"b"}]}}'
    expect(parseCodexLine(line)).toEqual({ kind: 'agent-text', text: 'a b' })
  })

  it('maps turn.completed to turn-complete', () => {
    expect(parseCodexLine('{"type":"turn.completed"}')).toEqual({ kind: 'turn-complete' })
  })

  it('maps turn.failed to a turn-failed event with a message', () => {
    const line = '{"type":"turn.failed","error":{"message":"rate limited"}}'
    expect(parseCodexLine(line)).toEqual({ kind: 'turn-failed', message: 'rate limited' })
  })

  it('maps error events to an error event with a message', () => {
    const line = '{"type":"error","message":"not authenticated"}'
    expect(parseCodexLine(line)).toEqual({ kind: 'error', message: 'not authenticated' })
  })

  it('parses every line of the sample fixture without throwing', () => {
    const fixture = readFileSync(join(__dirname, '../../fixtures/codex/sample-stream.jsonl'), 'utf8')
    const events = fixture.trim().split('\n').map(parseCodexLine)
    expect(events.some((e) => e.kind === 'agent-text')).toBe(true)
    expect(events.some((e) => e.kind === 'turn-complete')).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/event-parser.test.ts`
Expected: FAIL - cannot resolve the module.

- [ ] **Step 4: Write the implementation**

Create `src/main/codex/event-parser.ts`:

```ts
export type CodexEvent =
  | { kind: 'agent-text'; text: string }
  | { kind: 'turn-complete' }
  | { kind: 'turn-failed'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' }

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractText(item: Record<string, unknown>): string {
  if (typeof item.text === 'string') return item.text
  const content = item.content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object'
          ? asString((part as Record<string, unknown>).text)
          : '',
      )
      .join('')
  }
  return ''
}

export function parseCodexLine(line: string): CodexEvent {
  const trimmed = line.trim()
  if (trimmed.length === 0) return { kind: 'ignored' }

  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return { kind: 'ignored' }
    obj = parsed as Record<string, unknown>
  } catch {
    return { kind: 'ignored' }
  }

  const type = asString(obj.type)

  if (type === 'turn.failed') {
    const error = obj.error
    const message =
      error && typeof error === 'object'
        ? asString((error as Record<string, unknown>).message)
        : asString(error)
    return { kind: 'turn-failed', message: message || 'Codex turn failed.' }
  }

  if (type === 'error') {
    return { kind: 'error', message: asString(obj.message) || 'Codex reported an error.' }
  }

  if (type === 'turn.completed') return { kind: 'turn-complete' }

  if (type.startsWith('item.')) {
    const item = obj.item
    if (item && typeof item === 'object') {
      const itemObj = item as Record<string, unknown>
      const itemType = asString(itemObj.item_type) || asString(itemObj.type)
      if (itemType === 'agent_message') {
        const text = extractText(itemObj)
        if (text.length > 0) return { kind: 'agent-text', text }
      }
    }
  }

  return { kind: 'ignored' }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/event-parser.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Confirm the parser matches the real Codex output**

Run (requires `codex login` already done; if it fails for auth/network reasons, skip and note it for the auditor):

```bash
codex exec --json --ephemeral --skip-git-repo-check -s read-only "Reply with exactly: pong"
```

Inspect the JSONL. If agent-message events use a different `item_type` value or text field than the fixture assumes, update `tests/fixtures/codex/sample-stream.jsonl` and the `item_type`/`extractText` handling in `event-parser.ts` to match, then re-run Step 5. If the output already matches, change nothing.

- [ ] **Step 7: Commit**

```bash
git add src/main/codex/event-parser.ts tests/main/codex/event-parser.test.ts tests/fixtures/codex/sample-stream.jsonl
git commit -m "feat: add Codex JSONL event parser"
```

---

## Task 5: Stream helpers (line splitter and answer accumulator)

Two small pure helpers the runner needs: one to cut a streaming buffer into complete lines, one to turn cumulative agent text into incremental deltas.

**Files:**
- Create: `src/main/codex/line-splitter.ts`
- Create: `src/main/codex/answer-accumulator.ts`
- Test: `tests/main/codex/line-splitter.test.ts`
- Test: `tests/main/codex/answer-accumulator.test.ts`

- [ ] **Step 1: Write the failing line-splitter test**

Create `tests/main/codex/line-splitter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitLines } from '../../../src/main/codex/line-splitter'

describe('splitLines', () => {
  it('returns complete lines and keeps the trailing partial as rest', () => {
    const result = splitLines('', 'one\ntwo\nthr')
    expect(result.lines).toEqual(['one', 'two'])
    expect(result.rest).toBe('thr')
  })

  it('prepends the previous buffer before splitting', () => {
    const result = splitLines('thr', 'ee\nfour\n')
    expect(result.lines).toEqual(['three', 'four'])
    expect(result.rest).toBe('')
  })

  it('returns no lines when the chunk has no newline', () => {
    const result = splitLines('ab', 'cd')
    expect(result.lines).toEqual([])
    expect(result.rest).toBe('abcd')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/line-splitter.test.ts`
Expected: FAIL - cannot resolve the module.

- [ ] **Step 3: Write the line splitter**

Create `src/main/codex/line-splitter.ts`:

```ts
export interface SplitResult {
  lines: string[]
  rest: string
}

export function splitLines(buffer: string, chunk: string): SplitResult {
  const parts = (buffer + chunk).split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/line-splitter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing accumulator test**

Create `tests/main/codex/answer-accumulator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createAccumulator, accumulate } from '../../../src/main/codex/answer-accumulator'

describe('answer accumulator', () => {
  it('starts empty', () => {
    expect(createAccumulator().full).toBe('')
  })

  it('returns the whole first text as the delta', () => {
    const result = accumulate(createAccumulator(), 'Hello')
    expect(result.delta).toBe('Hello')
    expect(result.state.full).toBe('Hello')
  })

  it('returns only the new suffix when text grows cumulatively', () => {
    const first = accumulate(createAccumulator(), 'Hello')
    const second = accumulate(first.state, 'Hello there')
    expect(second.delta).toBe(' there')
    expect(second.state.full).toBe('Hello there')
  })

  it('emits no delta when the text is unchanged', () => {
    const first = accumulate(createAccumulator(), 'Hello')
    const second = accumulate(first.state, 'Hello')
    expect(second.delta).toBe('')
  })

  it('appends when new text is not a continuation of the old text', () => {
    const first = accumulate(createAccumulator(), 'Hello')
    const second = accumulate(first.state, 'World')
    expect(second.delta).toBe('World')
    expect(second.state.full).toBe('HelloWorld')
  })

  it('does not mutate the input state', () => {
    const start = createAccumulator()
    accumulate(start, 'Hello')
    expect(start.full).toBe('')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/answer-accumulator.test.ts`
Expected: FAIL - cannot resolve the module.

- [ ] **Step 7: Write the accumulator**

Create `src/main/codex/answer-accumulator.ts`:

```ts
export interface AccumulatorState {
  full: string
}

export interface AccumulateResult {
  state: AccumulatorState
  delta: string
}

export function createAccumulator(): AccumulatorState {
  return { full: '' }
}

export function accumulate(state: AccumulatorState, text: string): AccumulateResult {
  if (text === state.full) {
    return { state, delta: '' }
  }
  if (text.startsWith(state.full)) {
    return { state: { full: text }, delta: text.slice(state.full.length) }
  }
  return { state: { full: state.full + text }, delta: text }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/answer-accumulator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add src/main/codex/line-splitter.ts src/main/codex/answer-accumulator.ts tests/main/codex/line-splitter.test.ts tests/main/codex/answer-accumulator.test.ts
git commit -m "feat: add Codex stream helpers (line splitter, answer accumulator)"
```

---

## Task 6: Codex args builder

Builds the exact `codex exec` argument array. Pure, so it is unit-tested directly.

**Files:**
- Modify: `src/main/config/constants.ts`
- Create: `src/main/codex/codex-args.ts`
- Test: `tests/main/codex/codex-args.test.ts`

- [ ] **Step 1: Add the CODEX config block**

Append to `src/main/config/constants.ts`:

```ts
export const CODEX = {
  command: 'codex',
  timeoutMs: 60_000,
  scratchDirName: '.codex-scratch',
  reasoningEffort: 'low',
} as const
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/codex/codex-args.test.ts`:

```ts
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
      expect.arrayContaining(['-m', 'gpt-5']),
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/codex-args.test.ts`
Expected: FAIL - cannot resolve the module.

- [ ] **Step 4: Write the implementation**

Create `src/main/codex/codex-args.ts`:

```ts
import { CODEX } from '../config/constants'

export interface CodexArgsInput {
  prompt: string
  outputFile: string
  workdir: string
  model?: string
}

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
    `model_reasoning_effort="${CODEX.reasoningEffort}"`,
  ]
  if (input.model) {
    args.push('-m', input.model)
  }
  args.push(input.prompt)
  return args
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/codex-args.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/main/config/constants.ts src/main/codex/codex-args.ts tests/main/codex/codex-args.test.ts
git commit -m "feat: add Codex args builder and CODEX config"
```

---

## Task 7: Codex runner

Spawns the process, streams events, and resolves a result. It uses `node:child_process` directly, but it is fully testable: the `command` is a parameter, so tests point it at a mock `codex` binary written in Node. The final answer is read from the `-o` output file (the source of truth); the JSONL stream only drives progressive `onChunk` callbacks.

**Files:**
- Create: `tests/fixtures/codex/mock-codex-ok.mjs`
- Create: `tests/fixtures/codex/mock-codex-fail.mjs`
- Create: `tests/fixtures/codex/mock-codex-hang.mjs`
- Create: `src/main/codex/codex-runner.ts`
- Test: `tests/main/codex/codex-runner.test.ts`

- [ ] **Step 1: Create the mock `codex` binaries**

Create `tests/fixtures/codex/mock-codex-ok.mjs`:

```js
// Mock `codex exec`: emits a JSONL stream, writes the -o output file, exits 0.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const outIdx = args.indexOf('-o')
const outputFile = outIdx >= 0 ? args[outIdx + 1] : null
const finalText = 'A closure is a function bundled with its surrounding state.'

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
emit({ type: 'thread.started', thread_id: 't-mock' })
emit({ type: 'turn.started' })
emit({ type: 'item.updated', item: { id: 'i-1', item_type: 'agent_message', text: 'A closure is' } })
emit({ type: 'item.completed', item: { id: 'i-1', item_type: 'agent_message', text: finalText } })
emit({ type: 'turn.completed', usage: { input_tokens: 40, output_tokens: 12 } })

if (outputFile) writeFileSync(outputFile, finalText + '\n')
process.exit(0)
```

Create `tests/fixtures/codex/mock-codex-fail.mjs`:

```js
// Mock `codex exec` failure: emits an error event and exits non-zero.
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
emit({ type: 'thread.started', thread_id: 't-mock' })
emit({ type: 'turn.failed', error: { message: 'mock codex failure' } })
process.exit(1)
```

Create `tests/fixtures/codex/mock-codex-hang.mjs`:

```js
// Mock `codex exec` that never exits, to exercise the runner timeout.
setInterval(() => {}, 1000)
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/codex/codex-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runCodexQuery } from '../../../src/main/codex/codex-runner'

const FIXTURES = join(__dirname, '../../fixtures/codex')

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'codex-runner-'))
}

describe('runCodexQuery', () => {
  it('streams chunks and resolves with the output-file text on success', async () => {
    const dir = scratch()
    const outputFile = join(dir, 'answer.txt')
    const chunks: string[] = []
    const result = await runCodexQuery(
      {
        command: 'node',
        args: [join(FIXTURES, 'mock-codex-ok.mjs'), '-o', outputFile],
        outputFile,
        timeoutMs: 5000,
      },
      { onChunk: (delta) => chunks.push(delta) },
    )
    expect(result.ok).toBe(true)
    expect(result.text).toBe('A closure is a function bundled with its surrounding state.')
    expect(chunks.join('')).toBe('A closure is a function bundled with its surrounding state.')
  })

  it('resolves not-ok with the failure message when Codex exits non-zero', async () => {
    const dir = scratch()
    const outputFile = join(dir, 'answer.txt')
    const result = await runCodexQuery(
      {
        command: 'node',
        args: [join(FIXTURES, 'mock-codex-fail.mjs'), '-o', outputFile],
        outputFile,
        timeoutMs: 5000,
      },
      { onChunk: () => {} },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('mock codex failure')
  })

  it('resolves not-ok with a timeout message when the process hangs', async () => {
    const dir = scratch()
    const outputFile = join(dir, 'answer.txt')
    const result = await runCodexQuery(
      {
        command: 'node',
        args: [join(FIXTURES, 'mock-codex-hang.mjs'), '-o', outputFile],
        outputFile,
        timeoutMs: 300,
      },
      { onChunk: () => {} },
    )
    expect(result.ok).toBe(false)
    expect(result.error.toLowerCase()).toContain('timed out')
  })

  it('resolves not-ok when the command cannot be spawned', async () => {
    const result = await runCodexQuery(
      {
        command: 'definitely-not-a-real-binary-xyz',
        args: [],
        outputFile: '/tmp/none.txt',
        timeoutMs: 2000,
      },
      { onChunk: () => {} },
    )
    expect(result.ok).toBe(false)
    expect(result.error.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/main/codex/codex-runner.test.ts`
Expected: FAIL - cannot resolve `../../../src/main/codex/codex-runner`.

- [ ] **Step 4: Write the implementation**

Create `src/main/codex/codex-runner.ts`:

```ts
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { splitLines } from './line-splitter'
import { parseCodexLine } from './event-parser'
import { createAccumulator, accumulate, type AccumulatorState } from './answer-accumulator'

export interface RunCodexInput {
  command: string
  args: string[]
  outputFile: string
  timeoutMs: number
}

export interface RunCodexHandlers {
  onChunk: (delta: string) => void
}

export interface RunCodexResult {
  ok: boolean
  text: string
  error: string
}

export function runCodexQuery(
  input: RunCodexInput,
  handlers: RunCodexHandlers,
): Promise<RunCodexResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let buffer = ''
    let acc: AccumulatorState = createAccumulator()
    let streamError = ''
    let stderr = ''
    let settled = false

    const finish = (result: RunCodexResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, text: '', error: `Codex timed out after ${input.timeoutMs} ms.` })
    }, input.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const split = splitLines(buffer, chunk)
      buffer = split.rest
      for (const line of split.lines) {
        const event = parseCodexLine(line)
        if (event.kind === 'agent-text') {
          const next = accumulate(acc, event.text)
          acc = next.state
          if (next.delta.length > 0) handlers.onChunk(next.delta)
        } else if (event.kind === 'turn-failed' || event.kind === 'error') {
          streamError = event.message
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (err: Error) => {
      finish({ ok: false, text: '', error: `Failed to start Codex: ${err.message}` })
    })

    child.on('close', (code: number | null) => {
      if (code === 0) {
        readFile(input.outputFile, 'utf8')
          .then((text) => finish({ ok: true, text: text.trim(), error: '' }))
          .catch(() => finish({ ok: true, text: acc.full.trim(), error: '' }))
        return
      }
      const detail = streamError || stderr.trim() || `Codex exited with code ${code}.`
      finish({ ok: false, text: '', error: detail })
    })
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/main/codex/codex-runner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/main/codex/codex-runner.ts tests/main/codex/codex-runner.test.ts tests/fixtures/codex/mock-codex-ok.mjs tests/fixtures/codex/mock-codex-fail.mjs tests/fixtures/codex/mock-codex-hang.mjs
git commit -m "feat: add Codex subprocess runner with streaming and timeout"
```

---

## Task 8: Codex service and IPC handler

The service binds a question to the runner and emits IPC events. The IPC handler gains the `AskQuestion` channel. The service is glue (it touches the filesystem and is verified by typecheck/build); the IPC handler is dependency-injected and unit-tested.

**Files:**
- Create: `src/main/codex/codex-service.ts`
- Modify: `src/main/ipc/ipc-handlers.ts`
- Test: `tests/main/ipc/ipc-handlers.test.ts` (modify - the Phase 1 file)

- [ ] **Step 1: Write the codex service**

Create `src/main/codex/codex-service.ts`:

```ts
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { buildPrompt } from './prompt-builder'
import { buildCodexArgs } from './codex-args'
import { runCodexQuery } from './codex-runner'
import { CODEX } from '../config/constants'
import { IpcChannel, type AskQuestionRequest } from '../../shared/types'

export interface CodexServiceDeps {
  /** Directory where per-query scratch files are written. */
  scratchRoot: string
  /** Sends an IPC payload to the renderer. */
  emit: (channel: string, payload: unknown) => void
  /** The codex binary; defaults to CODEX.command. Overridable for tests. */
  command?: string
}

export interface CodexService {
  handleAsk: (request: AskQuestionRequest) => Promise<void>
}

export function createCodexService(deps: CodexServiceDeps): CodexService {
  async function handleAsk(request: AskQuestionRequest): Promise<void> {
    const outputFile = join(deps.scratchRoot, `answer-${request.requestId}.txt`)
    try {
      await mkdir(deps.scratchRoot, { recursive: true })
      const args = buildCodexArgs({
        prompt: buildPrompt(request.question),
        outputFile,
        workdir: deps.scratchRoot,
      })
      const result = await runCodexQuery(
        {
          command: deps.command ?? CODEX.command,
          args,
          outputFile,
          timeoutMs: CODEX.timeoutMs,
        },
        {
          onChunk: (delta) =>
            deps.emit(IpcChannel.AnswerChunk, { requestId: request.requestId, delta }),
        },
      )
      if (result.ok) {
        deps.emit(IpcChannel.AnswerDone, { requestId: request.requestId, text: result.text })
      } else {
        deps.emit(IpcChannel.AnswerError, {
          requestId: request.requestId,
          message: result.error,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Codex error.'
      deps.emit(IpcChannel.AnswerError, { requestId: request.requestId, message })
    }
  }

  return { handleAsk }
}
```

- [ ] **Step 2: Update the IPC handler test for the new channel**

Replace the whole body of `tests/main/ipc/ipc-handlers.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { registerIpcHandlers } from '../../../src/main/ipc/ipc-handlers'
import { IpcChannel } from '../../../src/shared/types'

function makeDeps() {
  return { onToggleInvisibility: vi.fn(), onAskQuestion: vi.fn() }
}

describe('registerIpcHandlers', () => {
  it('calls onToggleInvisibility when its channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      }),
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    handlers[IpcChannel.ToggleInvisibility]()
    expect(deps.onToggleInvisibility).toHaveBeenCalledOnce()
  })

  it('forwards the request payload when the AskQuestion channel receives a message', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const ipcMain = {
      on: vi.fn((c: string, l: (...args: unknown[]) => void) => {
        handlers[c] = l
      }),
    }
    const deps = makeDeps()
    registerIpcHandlers(ipcMain, deps)
    const request = { requestId: 'r-1', question: 'hello' }
    handlers[IpcChannel.AskQuestion]({}, request)
    expect(deps.onAskQuestion).toHaveBeenCalledWith(request)
  })

  it('registers handlers on both the ToggleInvisibility and AskQuestion channels', () => {
    const ipcMain = { on: vi.fn() }
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledWith(IpcChannel.ToggleInvisibility, expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith(IpcChannel.AskQuestion, expect.any(Function))
  })

  it('registers exactly two channel handlers', () => {
    const ipcMain = { on: vi.fn() }
    registerIpcHandlers(ipcMain, makeDeps())
    expect(ipcMain.on).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/main/ipc/ipc-handlers.test.ts`
Expected: FAIL - `onAskQuestion` is not handled; only one channel registered.

- [ ] **Step 4: Update the IPC handler**

Replace `src/main/ipc/ipc-handlers.ts` with:

```ts
import { IpcChannel, type AskQuestionRequest } from '../../shared/types'

export interface IpcMainLike {
  on(channel: string, listener: (...args: unknown[]) => void): void
}

export interface IpcHandlerDeps {
  onToggleInvisibility(): void
  onAskQuestion(request: AskQuestionRequest): void
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcHandlerDeps): void {
  ipcMain.on(IpcChannel.ToggleInvisibility, () => deps.onToggleInvisibility())
  ipcMain.on(IpcChannel.AskQuestion, (...args: unknown[]) => {
    deps.onAskQuestion(args[1] as AskQuestionRequest)
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/main/ipc/ipc-handlers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/main/codex/codex-service.ts src/main/ipc/ipc-handlers.ts tests/main/ipc/ipc-handlers.test.ts
git commit -m "feat: add Codex service and AskQuestion IPC handler"
```

---

## Task 9: Preload API and main-process wiring

Exposes `askQuestion` and the answer/status subscriptions to the renderer, then constructs the Codex service in `index.ts` and pushes the startup Codex status. The preload API is dependency-injected and unit-tested; `index.ts` is glue, verified by typecheck and build.

**Files:**
- Modify: `src/preload/api.ts`
- Test: `tests/preload/api.test.ts` (modify - the Phase 1 file)
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the failing preload tests**

Add these tests inside the existing `describe` block in `tests/preload/api.test.ts` (keep the Phase 1 tests intact):

```ts
  it('askQuestion sends the request on the AskQuestion channel', () => {
    const send = vi.fn()
    const api = createOverlayApi({ send, on: vi.fn(), removeListener: vi.fn() })
    const request = { requestId: 'r-1', question: 'hello' }
    api.askQuestion(request)
    expect(send).toHaveBeenCalledWith(IpcChannel.AskQuestion, request)
  })

  it('onAnswerChunk delivers the payload from the AnswerChunk channel', () => {
    const listeners: Record<string, (e: unknown, p: unknown) => void> = {}
    const api = createOverlayApi({
      send: vi.fn(),
      on: vi.fn((c: string, l: (e: unknown, p: unknown) => void) => {
        listeners[c] = l
      }),
      removeListener: vi.fn(),
    })
    const received: unknown[] = []
    api.onAnswerChunk((chunk) => received.push(chunk))
    listeners[IpcChannel.AnswerChunk]({}, { requestId: 'r-1', delta: 'hi' })
    expect(received).toEqual([{ requestId: 'r-1', delta: 'hi' }])
  })

  it('onCodexStatus subscribes to the CodexStatus channel and unsubscribes', () => {
    const removeListener = vi.fn()
    const api = createOverlayApi({ send: vi.fn(), on: vi.fn(), removeListener })
    const unsubscribe = api.onCodexStatus(() => {})
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(IpcChannel.CodexStatus, expect.any(Function))
  })
```

If the existing file does not already import `IpcChannel`, change its import line to:

```ts
import { createOverlayApi } from '../../src/preload/api'
import { IpcChannel } from '../../src/shared/types'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/preload/api.test.ts`
Expected: FAIL - `api.askQuestion` is not a function.

- [ ] **Step 3: Update the preload API**

Replace `src/preload/api.ts` with:

```ts
import {
  IpcChannel,
  type OverlayState,
  type AskQuestionRequest,
  type AnswerChunk,
  type AnswerResult,
  type AnswerError,
  type CodexStatus,
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
  onAnswerChunk(callback: (chunk: AnswerChunk) => void): () => void
  onAnswerDone(callback: (result: AnswerResult) => void): () => void
  onAnswerError(callback: (error: AnswerError) => void): () => void
  onCodexStatus(callback: (status: CodexStatus) => void): () => void
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
    onAnswerChunk: (callback) => subscribe(IpcChannel.AnswerChunk, callback),
    onAnswerDone: (callback) => subscribe(IpcChannel.AnswerDone, callback),
    onAnswerError: (callback) => subscribe(IpcChannel.AnswerError, callback),
    onCodexStatus: (callback) => subscribe(IpcChannel.CodexStatus, callback),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/preload/api.test.ts`
Expected: PASS (all Phase 1 tests plus the 3 new ones).

- [ ] **Step 5: Wire the Codex service into the main process**

Edit `src/main/index.ts`. Add these imports below the existing import block:

```ts
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { createCodexService } from './codex/codex-service'
import { checkCodexAvailability } from './codex/availability'
import { CODEX } from './config/constants'
import type { AskQuestionRequest } from '../shared/types'
```

Add these helpers above `app.whenReady()`:

```ts
function getCodexVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('codex', ['--version'], (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
}

function emitToOverlay(channel: string, payload: unknown): void {
  overlay?.webContents.send(channel, payload)
}
```

Inside `app.whenReady().then(() => { ... })`, after the existing `registerIpcHandlers(...)` call, replace that call so it also handles questions. The full block becomes:

```ts
  const scratchRoot = join(app.getPath('userData'), CODEX.scratchDirName)
  const codexService = createCodexService({ scratchRoot, emit: emitToOverlay })

  registerIpcHandlers(ipcMain, {
    onToggleInvisibility: () => {
      state = toggleInvisible(state)
      pushState()
    },
    onAskQuestion: (request: AskQuestionRequest) => {
      void codexService.handleAsk(request)
    },
  })

  void checkCodexAvailability({
    getVersion: getCodexVersion,
    authFileExists: () => existsSync(join(homedir(), '.codex', 'auth.json')),
  }).then((status) => emitToOverlay(IpcChannel.CodexStatus, status))
```

- [ ] **Step 6: Typecheck, build, and commit**

```bash
npm run typecheck
npm run build
git add src/preload/api.ts tests/preload/api.test.ts src/main/index.ts
git commit -m "feat: expose Codex API in preload and wire the service in main"
```

Expected: `typecheck` and `build` both succeed.

---

## Task 10: Renderer wiring (hook, AnswerPanel, App)

Adds the `useCodexAnswer` hook, upgrades `AnswerPanel` with thinking/streaming/error states, and wires `App` so submitting a question streams an answer. Renderer tests use the jsdom environment.

**Files:**
- Create: `src/renderer/src/hooks/useCodexAnswer.ts`
- Test: `tests/renderer/hooks/useCodexAnswer.test.ts`
- Modify: `src/renderer/src/components/AnswerPanel.tsx`
- Test: `tests/renderer/components/AnswerPanel.test.tsx` (modify - the Phase 1 file)
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/renderer/App.test.tsx` (modify - the Phase 1 file)

- [ ] **Step 1: Write the failing hook test**

Create `tests/renderer/hooks/useCodexAnswer.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodexAnswer } from '../../../src/renderer/src/hooks/useCodexAnswer'
import type { AnswerChunk, AnswerResult, AnswerError } from '../../../src/shared/types'

type Cb<T> = (payload: T) => void

let chunkCb: Cb<AnswerChunk> = () => {}
let doneCb: Cb<AnswerResult> = () => {}
let errorCb: Cb<AnswerError> = () => {}
let lastRequest: { requestId: string; question: string } | null = null

beforeEach(() => {
  lastRequest = null
  window.whisperglass = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion: vi.fn((req) => {
      lastRequest = req
    }),
    onAnswerChunk: vi.fn((cb: Cb<AnswerChunk>) => {
      chunkCb = cb
      return () => {}
    }),
    onAnswerDone: vi.fn((cb: Cb<AnswerResult>) => {
      doneCb = cb
      return () => {}
    }),
    onAnswerError: vi.fn((cb: Cb<AnswerError>) => {
      errorCb = cb
      return () => {}
    }),
    onCodexStatus: vi.fn(() => () => {}),
  }
})

describe('useCodexAnswer', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useCodexAnswer())
    expect(result.current.state.status).toBe('idle')
  })

  it('moves to streaming and records the question on ask', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('What is a closure?'))
    expect(result.current.state.status).toBe('streaming')
    expect(result.current.state.question).toBe('What is a closure?')
    expect(lastRequest?.question).toBe('What is a closure?')
  })

  it('appends chunks that match the active request id', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    const id = lastRequest!.requestId
    act(() => chunkCb({ requestId: id, delta: 'Hello' }))
    act(() => chunkCb({ requestId: id, delta: ' world' }))
    expect(result.current.state.text).toBe('Hello world')
  })

  it('ignores chunks for a stale request id', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    act(() => chunkCb({ requestId: 'stale', delta: 'nope' }))
    expect(result.current.state.text).toBe('')
  })

  it('replaces text and finishes on done', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    const id = lastRequest!.requestId
    act(() => doneCb({ requestId: id, text: 'final answer' }))
    expect(result.current.state.status).toBe('done')
    expect(result.current.state.text).toBe('final answer')
  })

  it('records the error on error', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('q'))
    const id = lastRequest!.requestId
    act(() => errorCb({ requestId: id, message: 'it broke' }))
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toBe('it broke')
  })

  it('retry re-asks the last question', () => {
    const { result } = renderHook(() => useCodexAnswer())
    act(() => result.current.ask('first question'))
    act(() => result.current.retry())
    expect(lastRequest?.question).toBe('first question')
    expect(result.current.state.status).toBe('streaming')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/hooks/useCodexAnswer.test.ts`
Expected: FAIL - cannot resolve `useCodexAnswer`.

- [ ] **Step 3: Write the hook**

Create `src/renderer/src/hooks/useCodexAnswer.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerChunk, AnswerResult, AnswerError } from '../../../shared/types'

export type CodexAnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface CodexAnswerState {
  status: CodexAnswerStatus
  question: string
  text: string
  error: string
}

export interface UseCodexAnswer {
  state: CodexAnswerState
  ask: (question: string) => void
  retry: () => void
}

const INITIAL: CodexAnswerState = { status: 'idle', question: '', text: '', error: '' }

export function useCodexAnswer(): UseCodexAnswer {
  const [state, setState] = useState<CodexAnswerState>(INITIAL)
  const requestIdRef = useRef('')
  const lastQuestionRef = useRef('')

  useEffect(() => {
    const offChunk = window.whisperglass.onAnswerChunk((chunk: AnswerChunk) => {
      if (chunk.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'streaming', text: s.text + chunk.delta }))
    })
    const offDone = window.whisperglass.onAnswerDone((result: AnswerResult) => {
      if (result.requestId !== requestIdRef.current) return
      setState((s) => ({ ...s, status: 'done', text: result.text }))
    })
    const offError = window.whisperglass.onAnswerError((error: AnswerError) => {
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
    window.whisperglass.askQuestion({ requestId, question: trimmed })
  }, [])

  const retry = useCallback(() => {
    if (lastQuestionRef.current.length > 0) ask(lastQuestionRef.current)
  }, [ask])

  return { state, ask, retry }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/hooks/useCodexAnswer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Update the AnswerPanel test for the new states**

Replace the whole body of `tests/renderer/components/AnswerPanel.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnswerPanel } from '../../../src/renderer/src/components/AnswerPanel'

describe('AnswerPanel', () => {
  it('shows the empty placeholder when idle with no text', () => {
    render(<AnswerPanel answer="" status="idle" />)
    expect(screen.getByText('No answer yet')).toBeInTheDocument()
  })

  it('shows a thinking placeholder while streaming with no text yet', () => {
    render(<AnswerPanel answer="" status="streaming" />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('shows the streamed text once chunks arrive', () => {
    render(<AnswerPanel answer="partial answer" status="streaming" />)
    expect(screen.getByText('partial answer')).toBeInTheDocument()
  })

  it('shows the final answer when done', () => {
    render(<AnswerPanel answer="final answer" status="done" />)
    expect(screen.getByText('final answer')).toBeInTheDocument()
  })

  it('shows the error message and a retry button on error', async () => {
    const onRetry = vi.fn()
    render(<AnswerPanel answer="" status="error" error="codex failed" onRetry={onRetry} />)
    expect(screen.getByText('codex failed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/AnswerPanel.test.tsx`
Expected: FAIL - `AnswerPanel` does not accept a `status` prop / does not render the new states.

- [ ] **Step 7: Update AnswerPanel**

Replace `src/renderer/src/components/AnswerPanel.tsx` with:

```tsx
import React from 'react'
import type { CodexAnswerStatus } from '../hooks/useCodexAnswer'

interface AnswerPanelProps {
  answer: string
  status: CodexAnswerStatus
  error?: string
  onRetry?: () => void
}

export function AnswerPanel({
  answer,
  status,
  error = '',
  onRetry,
}: AnswerPanelProps): React.JSX.Element {
  if (status === 'error') {
    return (
      <div className="answer-panel answer-panel--error">
        <p className="answer-panel__error">{error || 'Something went wrong.'}</p>
        {onRetry && (
          <button className="answer-panel__retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }

  const hasText = answer.trim().length > 0
  if (!hasText) {
    return (
      <div className="answer-panel">
        <p className="panel__empty">{status === 'streaming' ? 'Thinking...' : 'No answer yet'}</p>
      </div>
    )
  }

  return (
    <div className="answer-panel">
      <p className="answer-panel__text">{answer}</p>
    </div>
  )
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/AnswerPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 9: Update the App test**

Replace the whole body of `tests/renderer/App.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'

let askQuestion: ReturnType<typeof vi.fn>

beforeEach(() => {
  askQuestion = vi.fn()
  window.whisperglass = {
    toggleInvisibility: vi.fn(),
    onOverlayState: vi.fn(() => () => {}),
    askQuestion,
    onAnswerChunk: vi.fn(() => () => {}),
    onAnswerDone: vi.fn(() => () => {}),
    onAnswerError: vi.fn(() => () => {}),
    onCodexStatus: vi.fn(() => () => {}),
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
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))
    expect(askQuestion).toHaveBeenCalledOnce()
    expect(askQuestion.mock.calls[0][0].question).toBe('What is a closure?')
    expect(screen.getByText('What is a closure?')).toBeInTheDocument()
  })

  it('subscribes to overlay state, answer events, and Codex status', () => {
    render(<App />)
    expect(window.whisperglass.onOverlayState).toHaveBeenCalled()
    expect(window.whisperglass.onAnswerChunk).toHaveBeenCalled()
    expect(window.whisperglass.onCodexStatus).toHaveBeenCalled()
  })
})
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/App.test.tsx`
Expected: FAIL - `App` does not yet call `askQuestion` or subscribe to Codex status.

- [ ] **Step 11: Update App**

Replace `src/renderer/src/App.tsx` with:

```tsx
import React, { useEffect, useState } from 'react'
import { CommandBar } from './components/CommandBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { EyeToggle } from './components/EyeToggle'
import { SetupBanner } from './components/SetupBanner'
import { useCodexAnswer } from './hooks/useCodexAnswer'
import type { OverlayState, TranscriptSegment, CodexStatus } from '../../shared/types'
import './styles/theme.css'

export function App(): React.JSX.Element {
  const [invisible, setInvisible] = useState(false)
  const [segments] = useState<TranscriptSegment[]>([])
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const { state, ask, retry } = useCodexAnswer()

  useEffect(() => {
    const offState = window.whisperglass.onOverlayState((overlay: OverlayState) => {
      setInvisible(overlay.invisible)
    })
    const offStatus = window.whisperglass.onCodexStatus((status: CodexStatus) => {
      setSetupMessage(status.available && status.authenticated ? null : status.detail)
    })
    return () => {
      offState()
      offStatus()
    }
  }, [])

  return (
    <div className="app">
      <SetupBanner message={setupMessage} />
      <div className="app__bar">
        <CommandBar onSubmit={ask} disabled={state.status === 'streaming'} />
        <EyeToggle invisible={invisible} onToggle={() => window.whisperglass.toggleInvisibility()} />
      </div>
      {state.question.length > 0 && <p className="app__active-question">{state.question}</p>}
      <AnswerPanel answer={state.text} status={state.status} error={state.error} onRetry={retry} />
      <TranscriptPanel segments={segments} />
    </div>
  )
}

export default App
```

- [ ] **Step 12: Run the full suite, typecheck, and build**

```bash
npm run test
npm run typecheck
npm run build
```

Expected: every test passes (Phase 1 suite plus all Phase 2 tests), typecheck clean, build clean.

- [ ] **Step 13: Commit**

```bash
git add src/renderer/src/hooks/useCodexAnswer.ts tests/renderer/hooks/useCodexAnswer.test.ts src/renderer/src/components/AnswerPanel.tsx tests/renderer/components/AnswerPanel.test.tsx src/renderer/src/App.tsx tests/renderer/App.test.tsx
git commit -m "feat: stream Codex answers into the overlay UI"
```

---

## Task 11: Phase 2 verification

Automated checks plus a manual run against the real `codex` CLI.

**Files:**
- Create: `docs/superpowers/verification/2026-05-20-phase-2.md`

- [ ] **Step 1: Run the automated checks**

```bash
npm run test
npm run typecheck
npm run build
```

Record the test count and that all three pass.

- [ ] **Step 2: Manual run against real Codex**

Confirm `codex login` has been done, then run `npm run dev` and verify:

1. The overlay launches with no SetupBanner (Codex is available and authenticated).
2. Typing a question and pressing `Cmd+Return` (or clicking Ask) shows the question, then a "Thinking..." state.
3. A real answer streams into the answer panel within roughly 2 to 6 seconds.
4. The command bar input is disabled while an answer is streaming, and re-enabled when it finishes.
5. Temporarily renaming the auth file (`mv ~/.codex/auth.json ~/.codex/auth.json.bak`) and restarting shows the SetupBanner with the "run `codex login`" message; restore it afterward (`mv ~/.codex/auth.json.bak ~/.codex/auth.json`).
6. Forcing an error (for example, disconnecting the network) shows the error message and a Retry button in the answer panel, and Retry re-runs the last question.

- [ ] **Step 3: Write the verification record**

Create `docs/superpowers/verification/2026-05-20-phase-2.md` documenting the automated results (PASS with counts) and the manual checklist with each item's status. For any manual item that could not be checked in the implementer's environment, mark it explicitly as pending the user.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/verification/2026-05-20-phase-2.md
git commit -m "docs: record Phase 2 verification results"
```

---

## Plan self-review

**Spec coverage (section 8.4, 9, 18 Phase 2):**
- `codex exec --json --ephemeral --skip-git-repo-check -s read-only -C <dir> -o <file>` - Task 6 (`buildCodexArgs`). The spec's `-a never` is intentionally dropped (no such flag on `codex exec`).
- `-c model_reasoning_effort="low"` - Task 6.
- Parse `item.*` agent-message events for progressive streaming - Tasks 4, 7.
- `-o` final answer as source of truth - Task 7 (`runCodexQuery` reads the output file on exit 0).
- Prompt = fixed system instruction + question - Task 3. The rolling transcript is intentionally out of scope for Phase 2 (no transcript exists until Phase 3); `buildPrompt` extends cleanly later.
- Startup availability and auth check with `SetupBanner` - Tasks 2, 9, 10.
- Query error and timeout shown with a retry button - Tasks 7, 8, 10.
- 80%+ unit coverage on logic modules - every pure module (availability, prompt-builder, event-parser, line-splitter, answer-accumulator, codex-args) plus the runner has a dedicated test file.
- `--search`, `--output-schema`, `exec resume`, `-i` image attach - all deferred to Phase 5 per the roadmap; not in Phase 2 scope.

**Placeholder scan:** No "TBD"/"add error handling"-style placeholders; every code step shows complete code.

**Type consistency:** `CodexEvent`, `CodexStatus`, `AskQuestionRequest`, `AnswerChunk`, `AnswerResult`, `AnswerError`, `AccumulatorState`, `RunCodexInput/Handlers/Result`, `CodexAnswerStatus/State` are each defined once and referenced consistently. `IpcChannel` values match between `types.ts`, the preload, and the handlers. The Phase 1 test files for `ipc-handlers`, `api`, `AnswerPanel`, and `App` are explicitly updated (Tasks 8, 9, 10) so the suite stays green.

---

## Execution handoff

This plan is saved to `docs/superpowers/plans/2026-05-20-phase-2-codex-runner.md`. It will be executed with **subagent-driven development** under the project's 3-agent pipeline (implementer, auditor, documenter), all agents on the Opus model, on the branch `build/phase-2-codex-runner`.
