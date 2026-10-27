# 0006 — A chapter's content is HTML, not plain text

## Status

Accepted.

## Context

Chapter text arrives from EPUB spine items, uploaded HTML pages, articles and
PDFs. Only EPUB gave us markup; the other parsers flattened everything to
text. That lost the things a reader needs and a listener can hear: headings,
bullet points, tables, images. The reader already rendered `chapter.content`
as HTML, so the structure had somewhere to live — it was being thrown away
before it got there.

Two costs come with keeping it:

- Chapter content is untrusted input. It is rendered with `{@html}` and stored
  in IndexedDB, so the sanitizer is the only thing between an arbitrary EPUB
  and the app.
- Images have to survive a reload. `blob:` URLs die with the tab, so images
  are inlined as `data:` URLs inside the content. `data:` is exactly the scheme
  a sanitizer normally bans (it is a script vector in `href`).

## Decision

`Chapter.content` is sanitized HTML for every parser. One allowlist
(`src/lib/html/`) governs it: `script`, `style`, `iframe`, `svg`, `form` and
friends are removed, event handlers and `style`/`class` attributes are
stripped, `href` accepts only http(s) and relative URLs, and `src` accepts
`data:image/(png|jpeg|gif|webp|avif);base64` in addition to http(s).

Places that only care about words (word counts, reading time, language
detection) go through `htmlToText()` rather than stripping tags themselves.

## Consequences

- Old library books keep their plain text; they cannot be re-parsed because the
  source file was never stored. Re-importing gives them structure.
- The `data:image` hole is narrow and load-bearing: widen it and the sanitizer
  stops protecting the app.
- PDFs are reconstructed into the same HTML contract, so everything downstream
  works on them unchanged.
- Exported EPUBs extract the inlined images back into `OEBPS/images/`, because
  EPUB3 does not allow `data:` URIs in content documents.
