# PROTOTYPE — reader UX revamp (throwaway)

Question: **what should the whole app UX become?** — dead-simple happy path
(open book → read → listen, scroll between chapters without going back),
minimalist, lightweight. Covers TTS generation / playback / export integration,
the main page, book management and settings.

Run it:

```sh
pnpm dev
# open http://localhost:5173/prototype.html
```

Three variants, flip with the floating pill (or `←` / `→`). **A is the current
direction** and carries the iteration; B and C stay as comparison.

| Key   | Name          | Main page                                                                   | Reading                                                              | Listening / TTS                                                                                                                                                                                               | Settings                                                                                                                 |
| ----- | ------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **A** | **Vanish** ✅ | The book itself; Books overlay via the title, import via drag-drop/file/URL | Whole book as one scroll; chrome hides while reading (tap to reveal) | ▶ in the top bar; generation progress visible **in the text** (dim = pending, full = generated, pulsing = generating); spoken sentence highlights and follows the voice; transport stays up when chrome hides | `Aa` → panel: reading (theme/size), TTS (model/voice/quantization/device), playback speed, audiobook (generate + export) |
| B     | Shelf         | Cover-forward shelf with Continue hero                                      | Horizontally paged e-reader, tap thirds                              | Persistent audio dock + player sheet                                                                                                                                                                          | With the player                                                                                                          |
| C     | Split         | The split surface, no navigation                                            | Pane + chapter rail, `j`/`k`, `/` search                             | Status + play per rail row, bulk generate/export                                                                                                                                                              | ⚙ panel                                                                                                                  |

## Variant A details

- **Listening model (Eleven-style)**: narration never waits for the reader.
  Scrolling detaches the view — a `↓ Return to narration` pill appears and snaps
  back to the spoken sentence (scrolling back near it re-attaches on its own).
- **Generation tracking**: chapters are wrapped with the real
  `segmentationService`/`readerSegments` segments. `segment-pending` (dimmed),
  `segment-generating` (pulsing) and `segment-generated` (full) states show what
  text has been processed at a glance; the bottom strip shows overall % while
  generating; the TOC shows per-chapter badges (♪ / % / ○).
- **Spoken highlight**: the sentence being spoken gets `.active` (amber); the
  view follows it while attached, including across chapter breaks.
- **Import**: drop a file anywhere on the reader, or `＋ Import` for the panel —
  drag & drop, file picker, or URL. Real `loadBook` parsing, memory only.
- **Books overlay** (click the title): search, sort, per-book read/audio
  progress, open / listen / remove — built to stay usable at hundreds of books.
- **App settings** (gear in the Books overlay, or `Aa → App settings`): playback
  defaults + auto-continue, TTS model/voice/quantization/device, per-language
  voice defaults, storage (clear generated audio), about.
- **Empty main page**: `?empty` (or delete every book) shows the first-run
  screen — drop target, `＋ Add a book`, `Your books`, `Load demo books`.

## Pages/states covered vs. still open

Covered: reader + chrome, TOC, quick settings (Aa), app settings, books
management, import (drag/file/URL), first-run empty page, generation
states/progress, playback transport, URL-import error.

Still open for testing (not built yet) — pick what matters:

1. **Book detail / per-chapter settings** — voice, model and language overrides
   per chapter (the real `BookView` has them; needed for multilingual books).
2. **Export sheet** — real options (chapter markers, cover, bitrate) instead of
   the one-button stub, plus export progress.
3. **Failure states** — generation failure/retry, storage full, model load
   failure, offline.
4. **First-run onboarding** — the real app's model download / voice picking flow.
5. **Compact/mobile layout** — A is desktop-first; touch targets and the
   transport on small screens.
6. **Queue/progress center** — a single place for "what is generating / done /
   failed" across books (today it's per-book badges + the strip).

## Notes

- Books come from your **real library** (IndexedDB, read-only). Empty library →
  built-in demo books (banner shown). Imports are **in-memory only**.
- TTS generation/playback/export run against an **in-memory simulation**
  (`audioSim.svelte.ts` + `segmentMath.ts`, the latter unit-tested): realistic
  `none → queued → generating → ready` states, 2 concurrent jobs, durations from
  word counts, auto-advance into the next chapter. No real model is loaded.
- No persistence: positions and audio states live in memory for the session.
- Dev-only: `prototype.html` is not part of the production build.
- `←`/`→` are owned by the switcher. In B, page turning uses tap thirds, `‹ ›`
  edge buttons, or `Shift+←/→`. Esc returns from B's reader to the shelf.

Once the design settles: fold A into the real `LandingPage`/`BookView`/
`TextReader`/`SettingsPage` chain, wire the real generation service where
`audioSim` sits (its segment states already match `readerSegments`), and commit
this folder to a throwaway branch as the primary source — don't merge the
variants to main.
