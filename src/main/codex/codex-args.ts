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
