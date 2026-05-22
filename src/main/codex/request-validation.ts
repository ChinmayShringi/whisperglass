import type { AskQuestionRequest } from '../../shared/types'

// requestId must be a short token of safe characters only. This blocks path
// traversal: the requestId is used to build a scratch file name, and a value
// like `../../foo` must never be able to escape the scratch directory.
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/
const MAX_QUESTION_LENGTH = 4000

export function validateAskRequest(value: unknown): AskQuestionRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid question request.')
  }
  const record = value as Record<string, unknown>
  if (typeof record.requestId !== 'string' || !REQUEST_ID.test(record.requestId)) {
    throw new Error('Invalid request id.')
  }
  if (typeof record.question !== 'string') {
    throw new Error('Question must be text.')
  }
  const question = record.question.trim()
  if (question.length === 0) {
    throw new Error('Question must not be empty.')
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error('Question is too long.')
  }
  return { requestId: record.requestId, question }
}
