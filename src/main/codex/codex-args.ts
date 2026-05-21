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
