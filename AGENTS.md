Purpose

This file documents conventions and practical tips for automated agents (LLM-driven or human) working in this repository. It prefers using the `gh` CLI for GitHub interactions and Chrome DevTools / CDP (referred to here as "mcp") for e2e debugging. It also recommends a git `worktree` + branch workflow so multiple agents can work concurrently on the same machine without interfering with each other.

Scope & precedence

- The guidelines in this file apply to the entire repository unless a more deeply nested `AGENTS.md` overrides them.
- Direct system/developer/user instructions (prompts) take precedence over this file.

Architecture at a glance

- **Framework**: Svelte 5 (runes) + TypeScript, bundled with Vite
- **State management**: Svelte stores (`src/stores/`)
- **TTS engines**: Kokoro (`src/lib/kokoro/`), Piper (`src/lib/piper/`), Web Speech API (browser-native)
- **Persistence**: IndexedDB for books, audio segments, and model cache
- **Key patterns**: lazy imports for heavy modules, progressive audio playback, segment-based generation
- **Styling**: CSS variables for theming (`--bg-color`, `--text-color`, `--border-color`, `--primary-color`, `--surface-color`, `--shadow-color`, etc.). Component-scoped `<style>` blocks.
- **Shared constants/types**: `src/lib/` (e.g., `src/lib/exportFormats.ts`, `src/lib/audioConstants.ts`)
- **Dev server**: http://localhost:5173 (default Vite port)

Quick environment notes

- **Package Manager**: This project uses `pnpm`. Install dependencies with `pnpm install`.
- Node scripts: see `package.json` for the authoritative scripts. Common scripts:
  - `pnpm dev` — starts the Vite dev server (port 5173)
  - `pnpm build` — builds a production bundle
  - `pnpm preview` — preview the build
  - `pnpm test` — run unit tests with `vitest`
  - `pnpm test:e2e` — run Playwright e2e tests
  - `pnpm test:e2e:headed` — run Playwright e2e tests in headed mode
  - `pnpm lint` / `pnpm lint:fix` — ESLint + Prettier checks/fix
  - `pnpm type-check` — TypeScript type check
- For worktrees running simultaneously, use different ports: `VITE_PORT=5174 pnpm dev`

Known issues

- **prettier-plugin-svelte@4.0.0** crashes on `{@const}` directives containing `LogicalExpression` (`??`) or `CallExpression` (function calls). Affected files are listed in `.prettierignore`.
- **`pnpm build`** and **`pnpm type-check`** currently fail due to a `vite.config.ts` `manualChunks` type incompatibility with rolldown. This is pre-existing and unrelated to feature work.
- ESLint reports ~100+ `@typescript-eslint/no-explicit-any` **warnings** (not errors). These are intentional in test files, mocks, and FFmpeg/worker code.

Workflow: git worktree + branch (recommended for multi-agent)

Rationale: multiple agents and/or editors on the same machine should not share a single working copy. Use `git worktree` to create an isolated working directory per task/agent.

Example flow (from repository root):

- List existing worktrees: `git worktree list`
- If a worktree already exists for your task: `cd ../worktrees/existing-feature` and work there.
- Create a worktree and new branch in one command:
  - `git worktree add ../worktrees/my-feature -b my-feature` — creates `../worktrees/my-feature` and checks out a new branch `my-feature` there.
- Move into the worktree and work there:
  - `cd ../worktrees/my-feature`
  - Run and edit normally (start the dev server, run tests, make changes).
- Commit locally in the worktree; push when ready:
  - `git add -A && git commit -m "feat: short description of why"`
  - `git push -u origin my-feature`
- Create a PR with `gh` (preferred):
  - `gh pr create --title "Short title" --body "## Summary\n- bullet 1\n- bullet 2" --base main`

Notes:

- Use descriptive branch names and commit messages that explain the purpose (the why) not only the what.
- Avoid `git checkout` in the main working copy while agents are running in their worktrees.
- Clean up completed worktrees with `git worktree remove ../worktrees/my-feature` and consider pruning stale branches.

Commit strategy

- One logical change per commit (e.g., "feat: unify export formats" not "various changes").
- It's fine to stage multiple files if they're part of the same logical change.
- Don't commit unrelated fixes together — separate commits make review easier.

Post-merge cleanup (mandatory after every PR merge):

After a PR is merged, always perform these cleanup steps:

1. Delete the remote branch (if not auto-deleted by the merge):
   - `gh api repos/OWNER/REPO/git/refs/heads/BRANCH -X DELETE`
2. Remove the worktree:
   - `git worktree remove ../worktrees/my-feature`
   - Use `--force` if the worktree has stale uncommitted changes that are no longer needed.
3. Switch to the main repo and update local main:
   - `cd /path/to/main/repo`
   - `git fetch origin main && git reset --hard origin/main`
4. Delete the local feature branch:
   - `git branch -D my-feature`
5. Prune stale remote refs:
   - `git remote prune origin`
6. Verify clean state:
   - `git status` — should show clean working tree on main
   - `git worktree list` — should show only the main working copy

Before pushing (checklist)

1. `pnpm lint` — must pass (0 errors; warnings are acceptable)
2. `pnpm test` — all unit tests pass
3. `git diff --stat` — review what you're committing

Note: `pnpm type-check` and `pnpm build` have pre-existing failures (see Known issues). Don't block on them.

Using `gh` CLI (preferred) for GitHub interactions

- Authenticate once per machine with `gh auth login`.
- Create PRs: `gh pr create --title "..." --body "..." --base main`.
- View PRs and open in browser: `gh pr view --web`.
- Add reviewers: `gh pr edit --add-reviewer username` or during creation use `--reviewer`.
- Reference GitHub from automation scripts rather than using the web UI when possible.

E2E tests & debugging (Playwright + Chrome DevTools / CDP (mcp))

Playwright is used for e2e tests here (`pnpm test:e2e`). For debugging and deep inspection, prefer using Chrome DevTools and the Chrome DevTools Protocol (CDP / "mcp") as follows:

- Fast debug (Playwright inspector):
  - `PWDEBUG=1 npx playwright test --debug` or `PWDEBUG=1 npx playwright test --headed` opens the Playwright inspector which is useful for stepping through tests.
- Use Chrome DevTools / CDP for network/console/coverage inspection:
  1. Launch a real Chrome/Chromium with a remote debugging port:
     - macOS example:
       - `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/playwright-profile`.
  2. In your test setup, connect Playwright to that browser via CDP (example in code):
     - `const browser = await chromium.connectOverCDP('http://localhost:9222');`
     - This lets tests run against a DevTools-attached browser so you can open the DevTools and inspect pages, network, and console while tests run.
  3. Open Chrome DevTools and connect to the remote debugging endpoint (DevTools will auto-connect when you open `http://localhost:9222` in another browser), or use tools that can attach to the CDP endpoint.
- If you need to record traces or videos for failing tests, use Playwright tracing and video options (see Playwright docs). The repo already includes Playwright in devDependencies.

Agent-browser testing (mandatory for UI changes)

**After implementing any UI change, use the MCP Chrome DevTools (agent-browser) to manually verify the feature works before considering it done.** This catches issues that unit tests miss (styling, interaction bugs, runtime errors).

Workflow:

1. Start the dev server: `pnpm dev`
2. Navigate to the app: use `navigate_page` to `http://localhost:5173`
3. Test the feature interactively:
   - Use `take_snapshot` to capture page structure and identify elements
   - Use `click`, `fill`, `upload_file` etc. to interact with the UI
   - Use `take_screenshot` to visually verify styling and layout
   - Use `list_console_messages` to check for runtime errors
   - Use `evaluate_script` to inspect application state (stores, IndexedDB, etc.)
4. If the feature involves file upload, use test files from `example/` directory
5. **If you find a bug during agent-browser testing, fix it before moving on**

When to use agent-browser:

- **Always** after styling/layout changes — verify visual appearance
- **Always** after adding/modifying UI interactions — verify they work end-to-end
- **Always** after fixing a user-reported bug — reproduce and verify the fix
- When debugging complex state issues (generation, playback, export)
- When verifying cross-component workflows (upload → generate → export)

Keeping E2E tests up to date (mandatory)

**E2E tests must be updated whenever features are added or changed.** Stale E2E tests that don't cover current functionality are a liability.

Rules:

- **New feature = new E2E test.** If you add a user-facing feature, add or update an E2E test in `e2e/` that exercises it.
- **Bug fix = regression test.** If you fix a bug that could have been caught by E2E, add a test that would catch it if it regresses.
- **Changed behavior = updated test.** If you change how a feature works, update the corresponding E2E test to match.
- **Run E2E after changes:** `pnpm test:e2e` (or `pnpm test:e2e:fast` for quick smoke tests with the short EPUB).
- **Don't leave broken E2E tests.** If a test fails due to your change, fix the test — don't skip or delete it unless the tested feature was intentionally removed.

E2E test patterns:

- Use `example/` test files (EPUBs) for realistic input
- Test the full user flow: upload → chapter list → generate → verify output
- Test edge cases: empty chapters, large files, format switching
- Use `pnpm test:e2e:headed` to debug flaky tests interactively

Recommendations when running e2e locally/CI

- Run `pnpm dev` (or `pnpm preview` for a full build preview) before `pnpm test:e2e` when you need a live app server.
- For local debugging prefer `pnpm test:e2e:headed` so you can see the browser window.
- Use `PWDEBUG=1` whenever you want interactive test debugging.

Agent safety & repository etiquette

- Read the repo files you will edit before making changes — start with `package.json`, `vitest.config.ts`, `playwright.config.ts`, and `src/`.
- Make minimal, focused changes. Do not change unrelated code or formatting unless required by a pre-commit hook.
- Respect existing linters and pre-commit hooks: this repo uses `husky` + `lint-staged` (see `package.json` for details).
- Run `pnpm lint` before pushing changes to catch issues early.

Testing requirements for new features (Test-Driven Development)

This project follows **Test-Driven Development (TDD)** principles. Write tests BEFORE implementing functionality.

**When TDD applies**: new logic, bug fixes, new features with testable behavior.
**When TDD does NOT apply**: styling changes, config fixes, refactoring with no behavior change, documentation.

TDD Workflow (Red-Green-Refactor):

1. **Red**: Write a failing test that describes the desired behavior
   - Start with the simplest test case
   - Run test and verify it fails for the right reason
   - Do not write implementation yet

2. **Green**: Write minimal code to make the test pass
   - Implement only what's needed to pass the test
   - It's okay if the implementation is naive/simple
   - Run test and verify it passes

3. **Refactor**: Clean up code while keeping tests green
   - Improve structure, naming, efficiency
   - Run tests after each refactor to ensure nothing broke
   - Commit when tests pass

Test Requirements:

- **Unit tests are mandatory** for all new features and bug fixes. Place tests in `src/lib/**/*.test.ts` alongside the code they test.
  - Write tests FIRST before implementation (TDD)
  - Test both happy-path and error scenarios.
  - Test edge cases relevant to the feature (empty inputs, boundary conditions, state transitions, etc.).
  - Aim for meaningful coverage; focus on testing logic and behavior, not just line coverage.
- **E2E tests are strongly recommended** when the feature involves user interactions or cross-component workflows.
  - Add tests to `e2e/**/*.spec.ts` that verify the feature from the user's perspective.
  - E2E tests can be written after unit tests pass (since they're slower and more complex)
  - Test against realistic use cases (e.g., for audio playback, test playing different languages, switching chapters, etc.).
  - Use `pnpm test:e2e:headed` locally to debug flaky tests interactively.

TDD Best Practices:

- Start with the simplest test case, then add more complex ones
- One test should verify one specific behavior
- Keep test names descriptive: `should return mobile chunk size of 300 when on mobile device`
- Run tests frequently during development (`pnpm test --watch`)
- Commit after each green test (with passing implementation)
- If you find yourself writing implementation first, stop and write the test

- **Always run the full test suite before submitting changes:**
  - `pnpm lint` to catch style issues.
  - `pnpm test` to run all unit tests and ensure nothing breaks.
  - `pnpm test:e2e` to run end-to-end tests (or a subset if specified).
  - If any test fails, investigate and fix before pushing. Do not ignore failing tests.

Testing and validation

- Unit tests: `pnpm test` (vitest)
- E2E tests: `pnpm test:e2e` (Playwright)
- Lint and format: `pnpm lint` / `pnpm format`

Files & locations (quick references)

- Main scripts and dependencies: `package.json`
- Playwright config: `playwright.config.ts`
- Vitest config: `vitest.config.ts`
- Source code: `src/` (components, lib, etc.)
- E2E test specs: `e2e/` (e.g. `e2e/audiobook-generation.spec.ts`)

Troubleshooting tips

- If Playwright can't launch browsers (CI/mac differences), try installing Playwright browsers: `npx playwright install`.
- If you get port collisions when creating worktrees and running servers, use different dev server ports: `VITE_PORT=5174 pnpm dev`.
- If `gh` is not authenticated, run `gh auth login`.

End of AGENTS.md
