Purpose

This file documents conventions and practical tips for automated agents (LLM-driven or human) working in this repository. It prefers using the `gh` CLI for GitHub interactions and Chrome DevTools / CDP (referred to here as "mcp") for e2e debugging. It also recommends a git `worktree` + branch workflow so multiple agents can work concurrently on the same machine without interfering with each other.

Scope & precedence

- The guidelines in this file apply to the entire repository unless a more deeply nested `AGENTS.md` overrides them.
- Direct system/developer/user instructions (prompts) take precedence over this file.

Quick environment notes

- **Package Manager**: This project uses `pnpm`. Install dependencies with `pnpm install`.
- Node scripts: see `package.json` for the authoritative scripts. Common scripts:
  - `pnpm dev` — starts the Vite dev server
  - `pnpm build` — builds a production bundle
  - `pnpm preview` — preview the build
  - `pnpm test` — run unit tests with `vitest`
  - `pnpm test:e2e` — run Playwright e2e tests
  - `pnpm test:e2e:headed` — run Playwright e2e tests in headed mode
  - `pnpm lint` / `pnpm lint:fix` — ESLint + Prettier checks/fix
  - `pnpm type-check` — TypeScript type check

Workflow: git worktree + branch (recommended for multi-agent)

Rationale: multiple agents and/or editors on the same machine should not share a single working copy. Use `git worktree` to create an isolated working directory per task/agent.

Example flow (from repository root):

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
- **MCP Chrome DevTools for interactive testing**:
  - When available, use the MCP Chrome DevTools tools to interactively test functionality:
    - Start dev server: `pnpm dev`
    - Use `mcp_chromedevtool_navigate_page` to navigate to `http://localhost:5173`
    - Use `mcp_chromedevtool_take_snapshot` to capture page structure and identify elements
    - Use `mcp_chromedevtool_click`, `mcp_chromedevtool_fill`, etc. to interact with the UI
    - Use `mcp_chromedevtool_list_console_messages` to check for errors or debug logs
    - Use `mcp_chromedevtool_evaluate_script` to inspect application state
  - This approach is useful for:
    - Reproducing user-reported issues interactively
    - Testing complex interactions (e.g., clicking segments during generation)
    - Verifying fixes before writing formal E2E tests
    - Inspecting application state and console logs in real-time

Recommendations when running e2e locally/CI

- Run `pnpm dev` (or `pnpm preview` for a full build preview) before `pnpm test:e2e` when you need a live app server.
- For local debugging prefer `pnpm test:e2e:headed` so you can see the browser window.
- Use `PWDEBUG=1` whenever you want interactive test debugging.

Agent safety & repository etiquette

- Read the repo files you will edit before making changes — start with `package.json`, `vitest.config.ts`, `playwright.config.ts`, and `src/`.
- Make minimal, focused changes. Do not change unrelated code or formatting unless required by a pre-commit hook.
- Respect existing linters and pre-commit hooks: this repo uses `husky` + `lint-staged` (see `package.json` for details).
- Run `pnpm lint` and `pnpm type-check` before pushing changes to catch issues early.

Testing requirements for new features

- **Unit tests are mandatory** for all new features and bug fixes. Place tests in `src/lib/**/*.test.ts` alongside the code they test.
  - Test both happy-path and error scenarios.
  - Test edge cases relevant to the feature (empty inputs, boundary conditions, state transitions, etc.).
  - Aim for meaningful coverage; focus on testing logic and behavior, not just line coverage.
- **E2E tests are strongly recommended** when the feature involves user interactions or cross-component workflows.
  - Add tests to `e2e/**/*.spec.ts` that verify the feature from the user's perspective.
  - Test against realistic use cases (e.g., for audio playback, test playing different languages, switching chapters, etc.).
  - Use `pnpm test:e2e:headed` locally to debug flaky tests interactively.

- **Always run the full test suite before submitting changes:**
  - `pnpm lint` and `pnpm type-check` to catch style/type issues.
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
- If you get port collisions when creating worktrees and running servers, use different dev server ports via environment variables.
- If `gh` is not authenticated, run `gh auth login`.

If you want, I can:

- Add per-folder or per-file agent guidance (e.g. where to find tests, how to run a specific test).
- Create a small script `scripts/new-worktree.sh` to automate creating a worktree + branch template.

End of AGENTS.md
