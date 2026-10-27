# Audiobook Generator

Turns eBooks and web articles into spoken audio. The text of a chapter is split into segments, each segment becomes a stretch of audio, and the reader plays those segments back in order.

## Language

**Book**:
A titled work made of an ordered list of chapters. An uploaded eBook file and a URL-imported article both end up as a Book.
_Avoid_: document, file, item, title

**Chapter**:
The unit of text the reader reads aloud, and the unit playback moves through. A URL-imported article becomes a Book with a single Chapter.
_Avoid_: article, section, page, passage, part

**Article**:
A web page imported by URL. Its extracted text becomes one Chapter of a Book — not a separate kind of thing.
_Avoid_: use Chapter for the text itself

**Document structure**:
The headings, lists, tables and images a Chapter's text carries. It is kept alongside the text so the reader can show it and the app can speak it in order — not flattened away.
_Avoid_: format, formatting, layout, markup, styling

**File format**:
The container a Book arrives in: EPUB, PDF, HTML or TXT.
_Avoid_: format (on its own), type, extension

**Segment**:
The smallest piece of a Chapter that is spoken as a single stretch of audio, and the unit playback moves through one at a time. Segments are numbered from 0 within their Chapter.
_Avoid_: sentence, chunk, fragment, paragraph, piece

**Caption**:
The text a document prints with an image. It is what gets shown under the image and spoken in its place; alt text only stands in when there is no caption.
_Avoid_: description, alt text (as a synonym), label

**Table row**:
The unit a table is spoken in. One row is one Segment, with the header taken from the first row.
_Avoid_: line, record

**Quality tier**:
How good a segment's audio is, from cheapest (tier 0) to best (tier 2). A tier names an engine, a voice and a precision.
_Avoid_: quality level, quality setting, quality

**Fast pass**:
The first generation pass. It produces every segment of a Chapter at the cheapest tier so that playback can begin immediately.
_Avoid_: initial pass, first pass, warm-up

**Upgrade pass**:
The background pass that re-generates segments at a higher tier and swaps the new audio in without interrupting playback.
_Avoid_: refine pass, improve pass, quality pass
