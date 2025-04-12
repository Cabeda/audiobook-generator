# Audiobook Generator

A Deno script that converts EPUB books into M4B audiobooks using text-to-speech technology.

## Prerequisites

- [Deno](https://deno.land/manual/getting_started/installation)
- [FFmpeg](https://ffmpeg.org/download.html)

## Installation

### Local Installation

1. Clone this repository:

```bash
git clone <repository-url>
cd audiobook-generator
```

2. Run the script with Deno (no additional installation needed)

```bash
deno install -A --global --name=audiobook-generator cli.ts
```

### Global Installation via JSR

You can install the CLI tool globally using JSR:

```bash
deno install -A --name=audiobook-generator jsr:@jose.cabeda/audiobook-generator/cli
```

This will make the `audiobook-generator` command available globally in your system.

## Usage

Basic usage:

```bash
# If installed locally:
deno run --allow-read --allow-write cli.ts --file <path-to-epub>

# If installed globally:
audiobook-generator --file <path-to-epub>
```

### Options

- `--file` or `-f`: Path to the EPUB file (required)
- `--voice`: Voice to use for TTS (default: "af_sky")
- `--qtype`: Quantization type for the model (default: "q8")
- `--format`: Audio format to generate (default: "m4a", options: "m4a", "m4b")
- `--cores`: Number of parallel processes to use (default: half of awivailable CPU cores)
- `--start-chapter`: First chapter to process (default: 1)
- `--end-chapter`: Last chapter to process (default: process all chapters)
- `--list-voices`: Display available voices
- `--list-qtypes`: Display available quantization types
- `--list-formats`: Display available audio formats

### Examples

List available voices:

```bash
audiobook-generator --list-voices
```

List quantization types:

```bash
audiobook-generator --list-qtypes
```

Generate audiobook with specific voice and quantization:

```bash
audiobook-generator --file book.epub --voice en_joe --qtype q4
```

Process only chapters 5 to 10:

```bash
audiobook-generator --file book.epub --start-chapter 5 --end-chapter 10
```

## Output

The script will create:

1. Individual WAV files for each chapter
2. A final M4B audiobook file with chapters and metadata
3. All output files will be in an `output/<book-title>` directory

## Features

- Extracts book metadata and chapters from EPUB files
- Converts text to speech using Kokoro TTS
- Preserves chapter information in the final M4B
- Supports multiple voices and quantization types
- Handles HTML cleanup and text preprocessing

## Publishing to JSR

This package is published to [JSR](https://jsr.io) registry. To publish a new version:

1. Update the version number in `jsr.json`
2. Tag the commit with the version number:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. The GitHub Action will automatically publish the package to JSR.

Alternatively, you can publish manually:

```bash
# Using Deno
deno publish

# Using JSR CLI with npm
npx jsr publish
```

## Using as a Library

You can import and use the library functionality in your own projects:

```typescript
import { extractEPub, generateChapterAudioFiles, createAudiobook } from "jsr:@jose.cabeda/audiobook-generator";

// Your code here
```

## Roadmap

- Create a separate package for the audiobook generator ✅
- Publish the cli (using the library) ✅
- Add a web interface to test out the library
- Add a live demo of the voices and add an example with a book
- Support other ebook formats (e.g., MOBI, AZW3, etc...)

## Wild ideas

- Add an option to translate the book to another language
- Support embedding the audiobook into the EPUB file?
- Use an LLM to process and describe images
- How can tables be processed?
- Generate a summary of the book? Chapter by chapter?