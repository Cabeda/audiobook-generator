# Contributing to Audiobook Generator

## Prerequisites

- **Node.js** 20+
- **pnpm** (package manager)
- **Git**

## Setup

```bash
git clone https://github.com/Cabeda/audiobook-generator.git
cd audiobook-generator
pnpm install
pnpm dev
```

Open http://localhost:5173.

## Branch Naming

| Prefix      | Use case                        |
| ----------- | ------------------------------- |
| `feat/`     | New features                    |
| `fix/`      | Bug fixes                       |
| `docs/`     | Documentation changes           |
| `refactor/` | Code restructuring              |
| `test/`     | Adding or updating tests        |
| `chore/`    | Tooling, CI, dependency updates |

## Commit Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add sentence-level highlighting
fix: prevent OOM on long chapters
docs: update architecture diagram
test: add E2E for progressive playback
refactor: extract segmentation service
```

## PR Process

1. Create a feature branch from `main`
2. Make focused, logical commits (one change per commit)
3. Run the pre-push checklist (see below)
4. Open a PR with `gh pr create --title "..." --body "..." --base main`
5. Reference the issue number in the PR body

For AI agents and multi-agent workflows, see [AGENTS.md](./AGENTS.md) for worktree-based branch workflows.

## Pre-Push Checklist

```bash
pnpm lint        # Must pass (0 errors)
pnpm test        # All unit tests pass
git diff --stat  # Review what you're committing
```

> Note: `pnpm type-check` and `pnpm build` have pre-existing failures unrelated to feature work. Don't block on them.

## Testing Requirements

This project follows **Test-Driven Development (TDD)**. See the [AGENTS.md TDD section](./AGENTS.md) for full details.

- **Unit tests are mandatory** for new features and bug fixes (`src/lib/**/*.test.ts`)
- **E2E tests are strongly recommended** for user-facing changes (`e2e/**/*.spec.ts`)
- Write tests BEFORE implementation (Red → Green → Refactor)
- Run `pnpm test` before pushing

## Where to Find Things

| Feature area             | Path                                     |
| ------------------------ | ---------------------------------------- |
| Components (UI)          | `src/components/`                        |
| State management         | `src/stores/`                            |
| TTS generation pipeline  | `src/lib/services/generationService.ts`  |
| Audio playback engine    | `src/lib/audioPlaybackService.svelte.ts` |
| Kokoro TTS client        | `src/lib/kokoro/`                        |
| Piper TTS client         | `src/lib/piper/`                         |
| File parsers (EPUB, PDF) | `src/lib/parsers/`                       |
| EPUB3 export             | `src/lib/epub/`                          |
| Audio concatenation      | `src/lib/audioConcat.ts`                 |
| IndexedDB persistence    | `src/lib/libraryDB.ts`                   |
| TTS Worker               | `src/tts.worker.ts`                      |
| Worker manager           | `src/lib/ttsWorkerManager.ts`            |
| Utility functions        | `src/lib/utils/`                         |
| Type definitions         | `src/lib/types/`                         |
| E2E tests                | `e2e/`                                   |
| Test utilities           | `test/`, `src/test/`                     |
| Documentation            | `docs/`                                  |

## Code Style

- **Framework**: Svelte 5 with runes (`$state`, `$derived`, `$effect`)
- **Styling**: Component-scoped `<style>` blocks with CSS variables
- **Imports**: Lazy imports for heavy modules (ONNX, FFmpeg)
- **Linting**: ESLint + Prettier (run `pnpm lint:fix` to auto-fix)

## AI-Specific Workflows

See [AGENTS.md](./AGENTS.md) for:

- Git worktree workflow for concurrent agents
- Agent-browser testing with Chrome DevTools
- E2E test maintenance requirements
- Post-merge cleanup steps
