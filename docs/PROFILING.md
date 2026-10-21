# Profiling a full-book run

How to find memory leaks and CPU hot spots while the app processes a whole book.

```bash
pnpm test:e2e:profile
```

Runs `e2e/profile/full-book.spec.ts`: uploads _The Sign of the Four_ (16 chapters), generates
every chapter with Kokoro WASM q4, and writes artifacts to `test-results/profile/`.

The run takes tens of minutes. It is **not** part of `pnpm test:e2e` or the nightly suite —
`playwright.profile.config.ts` keeps it separate.

Requirements: the full Chromium build (`pnpm exec playwright install chromium`). The default
headless shell does not expose `performance.measureUserAgentSpecificMemory()` or the `Memory`
CDP domain, so the config forces `channel: 'chromium'`.

The run starts its own dev server and never reuses an existing one, so it can share a machine
with another checkout. Give it a port that is free:

```bash
PROFILE_PORT=5174 pnpm test:e2e:profile
```

Do not edit or hot-reload the app while it runs — a page reload invalidates the timeline, and
the run fails on `pageReloads > 0` instead of reporting bad numbers.

## What you get

| File                                                  | What it answers                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `memory.csv`, `report.json`                           | Memory over time: total, main thread, TTS worker, DOM nodes, listeners.                     |
| `trace.json`                                          | **CPU flame graph** — open in DevTools Performance panel. Main thread _and_ the TTS worker. |
| `allocations.heapprofile`                             | **Allocation flame graph** — open in DevTools Memory panel. Which stacks allocate the most. |
| `heap-before.heapsnapshot`, `heap-after.heapsnapshot` | **Leak diff** — DevTools Memory panel, Comparison view.                                     |

## Opening the artifacts

**CPU flame graph** — DevTools → Performance → _Load profile_ → `trace.json`. Then:

- _Flame Graph_ tab: widest bars are the hot stacks.
- Ctrl/Cmd+F a function name to jump to it.
- The track list has a `DedicatedWorker thread` entry — that is the TTS worker, where ONNX
  inference runs. The main thread is mostly idle during generation, so look there and in the
  export path.

The trace covers only the first 90 seconds of the run (see `TRACE_WINDOW_MS`) — book parsing,
model load and the first chapters. Chrome samples the CPU at ~7 kHz in tracing mode and the
interval is not configurable, so a 30-minute trace would be gigabytes. 90 seconds is enough to
cover the repeated per-segment hot path. Raise the constant to cover more, or move
`startTrace`/`finishTrace` if you want a different phase (e.g. export).

**Allocation flame graph** — DevTools → Memory → _Load profile_ → `allocations.heapprofile`.
Widest bars = most bytes allocated from that stack. This is where "we allocate too much" shows
up, as opposed to "the CPU is busy".

**Leak diff** — DevTools → Memory → _Load profile_ → `heap-before.heapsnapshot`, same for
`heap-after.heapsnapshot`, then pick _Comparison_ in the dropdown above the snapshot list.
Sort by `# Delta` / `Size Delta` descending.

The diff shows what survived the run. Things that grow with chapter count — segment metadata,
`Blob` references, event listeners, detached DOM — are leaks. A clean run grows only by the
book itself.

`heap-after` is taken **after** a forced GC, so garbage that was never collected does not show
up; only genuinely retained objects do.

## Reading `memory.csv`

```
elapsed_s,agent_mb,main_thread_mb,tts_worker_mb,main_heap_mb,dom_nodes,listeners
```

- `agent_mb` — the whole agent cluster: main thread + TTS worker + its **WASM heap**. This is
  the number that matters; it is the only one that sees the ONNX model and its scratch memory.
  `performance.memory` and CDP JS heap metrics cannot.
- `main_thread_mb` / `tts_worker_mb` — best-effort split. Chrome can attribute a terminated
  worker's memory to the window, so trust `agent_mb` and use the split only for trends.
- `main_heap_mb` — V8 JS heap of the main thread, no WASM, no blobs.
- `dom_nodes` / `listeners` — flat across a run means no DOM or listener leaks.

Every sample forces a GC (`measureUserAgentSpecificMemory` does that), so each row is
_retained_ memory, not peak.

Signals worth chasing:

- `agent_mb` climbing across chapters with no plateau → the worker's WASM heap is not being
  reclaimed. Worker restarts (logged as `[OOM mitigation] Restarting TTS worker`) should make
  it saw-tooth, not monotonic.
- `agent_mb` still high long after generation finishes → something keeps blobs or model
  memory alive.
- `listeners` or `dom_nodes` growing per chapter → component teardown leak.

## How it is measured

- `performance.measureUserAgentSpecificMemory()` (CDP `Memory` domain not needed) for the agent
  cluster total. Requires cross-origin isolation, which `vite.config.ts` already enables with
  COOP/COEP.
- CDP `Performance.getMetrics` for the main-thread JS heap.
- CDP `Memory.getDOMCounters` for node and listener counts.
- CDP `Tracing.start` with `traceConfig.enableSampling` for CPU profiles. Playwright's
  `browser.startTracing()` does **not** enable sampling and yields a trace with no flame graph.
- CDP `Memory.startSampling` / `getSamplingProfile` for allocation sampling.
- CDP `HeapProfiler.takeHeapSnapshot` for the snapshots.

## Not covered

- WASM and Blob memory do not appear in the heap snapshots — they are outside the V8 heap. Use
  `agent_mb` for those.
- The TTS worker is terminated and recreated every 3 chapters on desktop (every chapter on
  mobile), so its own JS heap is short-lived; only the tracer captures per-type CPU profiles
  inside it.
