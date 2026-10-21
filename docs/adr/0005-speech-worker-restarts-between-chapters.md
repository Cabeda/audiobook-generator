# The speech worker is restarted between chapters to reclaim WASM heap

Generation runs in a web worker, and the worker is terminated and recreated periodically — after every chapter on mobile, after every third chapter on desktop, and sooner when memory pressure is high. WASM heap that a speech engine allocates is not reliably returned to the OS, so a long book would otherwise grow until Android's OOM killer takes the renderer.

A leaking engine looks like a bug to fix rather than a condition to work around, so this is the kind of thing a later reader would "clean up". It is not cleanup: the restart is the mitigation, and it is why generation keeps per-chapter bookkeeping instead of a single long-lived worker session.

## Consequences

- Model load cost is paid again on each restart, which is why restarts are per chapter and not per segment.
- Generation state has to survive a worker being torn down mid-book, and does.
