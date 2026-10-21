# Everything runs in the browser, there is no server

The app generates speech, stores Books and plays audio entirely on the user's device: Books and audio segments live in IndexedDB, and speech models are downloaded from public model hosts into the browser's cache on first use.

A server doing the work was the obvious alternative, but it would have meant paying for inference on every book, holding other people's books and audio, and dealing with upload size limits. Running locally keeps the app free to host and the user's library private. The cost is that generation speed is whatever the device can do, and the app has to manage memory itself — see ADR-0002 and ADR-0005.

## Considered Options

- **Server-side inference** — rejected: cost scales with use, and books would have to be uploaded.
- **Hybrid (server for slow devices)** — rejected: still needs the privacy and cost story, doubles the work.
