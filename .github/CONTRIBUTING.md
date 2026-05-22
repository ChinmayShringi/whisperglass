# Contributing to Whisperglass

Thanks for your interest in improving Whisperglass. It is a local-first macOS
AI meeting-copilot overlay: it transcribes meetings on-device with whisper.cpp
and answers through the locally installed `codex` CLI, with no API key in the
app. This guide covers how to get set up and what a change needs to pass before
you open a pull request.

## Prerequisites

- macOS on Apple Silicon (arm64). The app is macOS-only and will not build or
  run elsewhere.
- Node.js (with npm). CI runs on Node 22, so develop against that line.
- The `codex` CLI installed and authenticated. Run `codex login` once.
- An Xcode / Swift toolchain (Swift 6) to build and test the capture sidecar.
- CMake and a C/C++ toolchain to build the bundled whisper.cpp binary.

## Local setup

```sh
# Install Node dependencies
npm install

# Build the bundled whisper.cpp binary (one-time)
bash scripts/setup-whisper.sh

# Build the Swift capture sidecar (one-time)
bash scripts/setup-sidecar.sh

# Run the app in development
npm run dev
```

The whisper model file is downloaded automatically on first app run, not by the
setup scripts.

## Project layout

- `src/main` - Electron main process: app lifecycle, overlay window, hotkeys,
  IPC, child-process supervision.
- `src/preload` - the `contextBridge` preload API exposed to the renderer.
- `src/renderer` - the React + TypeScript overlay UI.
- `src/shared` - types and helpers shared across processes.
- `sidecar` - the Swift capture sidecar (audio and screenshot capture).
- `tests` - the Vitest suite.
- `docs` - project documentation and verification checklists.

## Quality gates

Before opening a pull request, run the full set of checks locally and make sure
they pass:

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

If your change touches the Swift sidecar, also run:

```sh
swift test --package-path sidecar
```

CI runs all of these on `macos-latest` and must be green for a PR to merge.

## Code style

- TypeScript: no semicolons, single quotes, 2-space indentation. Formatting is
  handled by Prettier. Run `npm run format` before committing.
- Tests use Vitest 4 with no globals. Import what you need (`describe`, `it`,
  `expect`, `vi`, and so on) directly from `vitest`.
- Swift: follow the existing style in the `sidecar` sources.
- Add or update tests alongside any new logic. New behavior without tests will
  be asked to add them.

## Commit messages

Use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

```
feat: stream codex answers token by token
fix: restart sidecar after capture crash
```

## Pull request process

1. Fork the repo, or create a branch if you have push access.
2. Make your change, with tests, and confirm the quality gates above pass.
3. Open a pull request against `main`. Fill in the PR template.
4. Make sure CI is green. A maintainer will review from there.

## A note on platform

Whisperglass is macOS-only by design. Please do not open PRs that add Windows
or Linux support paths; they fall outside the scope of the project.
