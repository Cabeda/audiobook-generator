# Rewrite Plan — Web UI using KokoroJS (frontend only)

## Goal

Rewrite the existing Deno CLI audiobook generator into a browser-only web application that:
- Accepts an EPUB file uploaded by the user.
- Parses the EPUB in the browser and extracts metadata and chapters.
- Uses KokoroJS (client-side) to generate audio per chapter, chunking when necessary.
- Packages the resulting audio into a downloadable audiobook (M4A/M4B) entirely in the browser (no backend required).

This project will take inspiration and implementation ideas from https://github.com/eduardolat/kokoro-web but must run fully client-side.

## Assumptions

- Target browsers are modern (Chromium, Firefox, Safari) with WebAssembly support. WebGPU optional.
- Users are willing to download model files to their browser cache (IndexedDB / Cache API) or accept network fetches.
- We'll use KokoroJS client bindings (npm package) in the browser. If KokoroJS has Node-only bindings, we will adapt by using the web-friendly portions from kokoro-web (onnxruntime-web, phonemizer, tokenizer).
- Packaging into M4A/M4B will use ffmpeg.wasm (or a light in-browser alternative). This is large — warn users and provide a fallback to per-chapter WAV/MP3 downloads if packing is not possible.

## High-level architecture

- Frontend: SvelteKit (or plain Svelte with Vite) single-page app.
- Client libraries:
	- kokoro-js (Kokoro runtime)
	- onnxruntime-web (WebAssembly ONNX runtime)
	- epub.js or jszip + DOMParser for EPUB parsing
	- ffmpeg.wasm for in-browser audio packaging (optional)
	- localForage / IndexedDB for caching model/voice artifacts

No backend. All processing, model loading, voice generation and packaging will happen inside the browser.

## Data flow

1. User uploads an EPUB file via drag-and-drop or file picker.
2. EPUB parser extracts title, author, cover, and an ordered list of chapters (HTML content).
3. Sanitizer cleans HTML to plain text and extracts/derives titles using heuristics (this repo already contains title heuristics in `parser.ts`).
4. Text preprocessor converts punctuation into silence markers and segments text (use kokoro-web textProcessor logic).
5. For each chapter, split into phoneme/token chunks respecting the model context window.
6. Call KokoroJS generate function per-chunk to produce raw waveform buffers and concatenate into chapter audio.
7. Optionally post-process (speed change) or encode to MP3/AAC in-browser.
8. Package chapters into a single M4A/M4B file using ffmpeg.wasm or provide per-chapter file downloads.

## Components (UI)

- UploadArea — file picker + drag & drop. Show EPUB metadata preview.
- BookInspector — shows title, author, cover, and list of chapters with checkboxes.
- TTSControls — voice selection, model quantization, speed, format, execution acceleration (CPU / WebGPU toggle).
- GeneratePanel — start/pause/cancel generation, shows overall progress and per-chapter progress.
- AudioList / Player — preview generated chapters before packaging.
- ExportPanel — package options (single file vs chapters), packaging progress, and download link.
- Settings & CacheManager — let users clear cached model files.

## Key implementation details

- EPUB parsing: Use `epub.js` or `JSZip` + DOMParser. The existing `parser.ts` has heuristics for extracting chapter titles; reuse/adapt that logic client-side.
- Text preprocessing: Reuse kokoro-web's sanitizeText/segmentText and phonemizer/tokenizer logic (ported into our codebase) to ensure compatibility with Kokoro-82M tokens.
- Model runtime: Use `onnxruntime-web` for onnx Kokoro model in the browser. If kokoro-js wraps this, prefer kokoro-js browser bindings. Persist downloaded model/voice artifacts to IndexedDB so users don't re-download every session.
- Chunked generation: Process chunks sequentially per chapter to keep memory bounded; run chapters in parallel only if device resources allow.
- Audio buffers: Collect Float32Array waveforms per-chapter then create WAV/MP3 using a light encoder. Use `wav-encoder` + `lamejs` or other in-browser encoders as needed.
- Packaging: ffmpeg.wasm provides the most straightforward path to create m4b/m4a containers with chapter metadata (FFMETADATA). Provide a fallback: zip per-chapter MP3/WAV for download.

## UI/UX notes

- Show explicit warnings about model download sizes and CPU/memory usage.
- Provide a "Demo small excerpt" mode with a short sample text to try Kokoro without downloading the whole model.
- Make generation resumable: provide a persisted queue and ability to resume generation from a given chapter.

## Edge cases & risks

- Model size and browser memory limits: large models may not be practical. Mitigation: support small Kokoro variants, use quantized models (q4/q8) and WebGPU if available.
- Browser incompatibility (Safari): test on target browsers; provide fallbacks.
- ffmpeg.wasm size and speed: packaging may be slow and heavy; document this and provide per-chapter download fallback.
- Licensing: kokoro-web uses MIT/Apache artifacts — verify model licensing before bundling.

## Milestones & tasks

1. Project scaffolding (SvelteKit or Vite + Svelte): create repo, routes, basic layout, and theme. (1–2 days)
2. EPUB parser UX + logic (port `parser.ts` to client and build UploadArea & BookInspector). (1–2 days)
3. Text preprocessing + tokenizer/phonemizer port (re-use kokoro-web helpers). (2–3 days)
4. KokoroJS/onnxruntime-web integration + model download & caching. Implement demo small-text mode first. (3–5 days)
5. Chunked audio generation per chapter and in-browser encoding to WAV/MP3. (2–4 days)
6. Packaging: integrate ffmpeg.wasm to create M4B/M4A with chapter metadata; implement fallback zipping. (2–4 days)
7. Polishing: progress UI, error handling, settings, tests, README, deployment. (2–3 days)

## Tests and quality gates

- Unit tests for parser (chapter extraction, title heuristics), sanitizer and segmenter.
- Small integration test: upload small EPUB, generate single short chapter (run in CI using Playwright or Cypress headless).
- Manual tests across browsers for memory and performance.

## Deliverables

- A Svelte-based web app in the repo root (or `/web`) with a README describing how to run locally.
- Key source files: `src/routes/+page.svelte`, `src/lib/epubParser.ts`, `src/lib/kokoroClient.ts`, `src/lib/textProcessor.ts`, `src/components/*`.
- Minimal demo EPUB and sample presets.

## Next immediate actions (what I'll do next)

1. Start by drafting `package.json` and SvelteKit/Vite scaffolding for the new web UI.
2. Port `parser.ts` logic into a browser-friendly `src/lib/epubParser.ts` and create an `UploadArea` component.

If you'd like, I can scaffold the Svelte app next and port the EPUB parser into `src/lib/epubParser.ts` so you can test parsing in the browser. Tell me which step to start with.

---

Document created: plan for a frontend-only KokoroJS-based EPUB->Audiobook web UI.
