# Coding Standards

Read at review time. Implementation agents work from AGENTS.md; reviewers hold
the diff to these rules.

## Seams over components

Logic that decides anything (mapping, planning, timing, persistence rules) lives
in a plain module under `src/lib/**` or `src/stores/**`, pinned by unit tests.
`.svelte` and `.svelte.ts` files hold rendering and bindings — vitest cannot run
runes here, so untestable logic is misplaced logic. The seams this repo trusts:
`readerViewState`, `listenPlan`, `bookSession`, `audiobookService`, `hashRoutes`.

## Failures surface

A user-triggered action never ends in `void promise`. Rejections reach the user
(a toast, an error strip) or the log; `void` is for fire-and-forget internals
only. The silent failure this prevents: pressing play and nothing happens.

## Reactive state, not reads

Anything a template renders is `$state`/`$derived` (or a store the template
subscribes to). A bridge object read through `get()` is invisible to Svelte
tracking and silently freezes its UI; if a bridge must use `get()`, its
consumers read the underlying store in the same expression.

## Language and engines answer from one place

Engine identity, capabilities and voice catalogues come from
`src/lib/tts/ttsModels.ts` (one `ENGINES` entry per engine). Chapter language
comes from `resolveChapterLanguageWithDetection`. Comparing engine names or
re-declaring language rules elsewhere is drift — the kitten and Portuguese bugs
were both this.

## Errors at trust boundaries

Imports, URL fetches and stored data (`localStorage`, IndexedDB, chapter ids
from past sessions) validate before use; a stored id is not proof of a live
session (`sessionChapterId`).
