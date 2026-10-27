# 0007 — A table row is one segment

## Status

Accepted.

## Context

A Segment is the unit of audio and the unit playback moves through (ADR 0002
stores audio per segment). A table read cell by cell is unlistenable — "Name.
Bob. Age. 42." — so the row has to be the spoken unit: the header is spoken
once, then each row as "Bob, 42".

Segment identity is a DOM element id (`seg-N`): the reader highlights by it,
clicking it moves playback, and the exported EPUB's SMIL references `#seg-N`.
HTML does not allow a `<span>` inside `<tr>`, so a row cannot be wrapped in a
single element.

## Decision

One segment per `<tr>`. Every cell's text is wrapped in a `.segment` span
carrying `data-segment-index="N"`; only the first cell's span also carries
`id="seg-N"`. The segment's text is the row's cells joined by `", "`, with the
header row spoken as its own row first.

`getSegmentIndex()` reads the id when present and `data-segment-index`
otherwise, so a click anywhere in the row resolves to the row.

## Consequences

- Highlighting covers the whole row, because the reader highlights every
  element matching `data-segment-index`.
- In a compliant ePub reader, the media overlay highlights only the first cell
  of the row. Accepted: the audio is right and the text is right.
- Cell-by-cell playback is not available for tables. That is the point.
