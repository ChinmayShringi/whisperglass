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
