import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { buildPrompt } from './prompt-builder'
import { buildCodexArgs } from './codex-args'
import { runCodexQuery } from './codex-runner'
import { validateAskRequest } from './request-validation'
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
  handleAsk: (request: unknown) => Promise<void>
}

function requestIdOf(request: unknown): string {
  if (request && typeof request === 'object') {
    const id = (request as Record<string, unknown>).requestId
    if (typeof id === 'string') return id
  }
  return ''
}

export function createCodexService(deps: CodexServiceDeps): CodexService {
  // Single-flight guard: only one codex subprocess may run at a time. The
  // check-and-set below runs with no await in between, so it is atomic on the
  // single JS thread.
  let inFlight = false

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

    const outputFile = join(deps.scratchRoot, `answer-${validated.requestId}.txt`)
    inFlight = true
    try {
      await mkdir(deps.scratchRoot, { recursive: true })
      const args = buildCodexArgs({
        prompt: buildPrompt(validated.question),
        outputFile,
        workdir: deps.scratchRoot
      })
      const result = await runCodexQuery(
        {
          command: deps.command ?? CODEX.command,
          args,
          outputFile,
          timeoutMs: CODEX.timeoutMs
        },
        {
          onChunk: (delta) =>
            deps.emit(IpcChannel.AnswerChunk, { requestId: validated.requestId, delta })
        }
      )
      if (result.ok) {
        deps.emit(IpcChannel.AnswerDone, { requestId: validated.requestId, text: result.text })
      } else {
        deps.emit(IpcChannel.AnswerError, {
          requestId: validated.requestId,
          message: result.error
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Codex error.'
      deps.emit(IpcChannel.AnswerError, { requestId: validated.requestId, message })
    } finally {
      inFlight = false
      await rm(outputFile, { force: true }).catch(() => {})
    }
  }

  return { handleAsk }
}
