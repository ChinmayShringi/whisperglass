// Pure exponential-backoff calculator for the sidecar supervisor. attempt 1
// yields the base delay, each later attempt doubles it, and the result is
// capped at the maximum. attempt values below 1 are clamped to 1 so the
// caller never has to special-case the first restart.
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const safeAttempt = attempt < 1 ? 1 : attempt
  const raw = baseMs * 2 ** (safeAttempt - 1)
  return Math.min(raw, maxMs)
}
