# Web Speech plays audio, it never generates it

The browser's Web Speech API is used only as a fallback so that a chapter with no generated audio can still be listened to. It is not a quality tier and never appears on the tier ladder, because it hands audio straight to the speaker and produces no file to store, export, upgrade or resume.

It is tempting to treat it as the cheapest tier, and earlier versions did: it is free, instant and needs no model download. But a "segment" in this app is audio that exists on disk and can be replaced later, and Web Speech breaks both halves of that. Keeping it out of the ladder means every segment's audio is a real file, and quality is only ever a choice between engines that write one.

## Considered Options

- **Web Speech as tier 0** — rejected: no audio to persist, so segments would have two incompatible shapes.
- **Drop it entirely** — rejected: it is the only way to hear a chapter before a model has downloaded.
