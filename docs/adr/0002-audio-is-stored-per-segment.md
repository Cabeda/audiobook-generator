# Audio is stored per segment, not per chapter

Each generated segment is persisted to IndexedDB on its own, keyed by chapter and index. A chapter's audio is never stored as one concatenated blob; concatenation happens only at export time, on demand.

Per-chapter blobs are the simpler shape, and they are what the merged playback path ultimately builds. But a chapter can be hundreds of segments, and holding them all in memory to write one blob is what gets the renderer killed on Android. Storing segments separately also means generation can resume after an interruption without redoing finished work, and the reader can start playing the first segments long before the chapter is done.

## Consequences

- Export has to read every segment back and concatenate, which is the slow part of exporting a long book.
- Anything that needs chapter audio as a whole (duration, chapter markers, M4B chapters) computes it from the segments.
