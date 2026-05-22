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
