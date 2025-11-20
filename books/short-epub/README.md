This folder contains a tiny 3-chapter sample book for tests.

To create an EPUB using pandoc run the following command from the repository root (macOS / zsh):

```bash
pandoc \
  --metadata-file=books/short-epub/metadata.yaml \
  --toc \
  -o books/test-short.epub \
  books/short-epub/01-chapter-1.md \
  books/short-epub/02-chapter-2.md \
  books/short-epub/03-chapter-3.md
```

Or, if you have Node.js and npm available, use the repository shortcut:

```bash
npm run build:epub
```

If you don't have pandoc installed, install it using Homebrew:

```bash
brew install pandoc
```

Or visit https://pandoc.org/installing.html for other options.
