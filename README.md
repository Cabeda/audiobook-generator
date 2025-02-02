# Audiobook Generator

A Deno script that converts EPUB books into M4B audiobooks using text-to-speech technology.

## Prerequisites

- [Deno](https://deno.land/manual/getting_started/installation)
- [FFmpeg](https://ffmpeg.org/download.html)

## Installation

1. Clone this repository:

```bash
git clone <repository-url>
cd audiobook-generator
```

2. Run the script with Deno (no additional installation needed)

## Usage

Basic usage:

```bash
deno run --allow-read --allow-write epub.ts --file <path-to-epub>
```

### Options

- `--file` or `-f`: Path to the EPUB file (required)
- `--voice`: Voice to use for TTS (default: "af_sky")
- `--qtype`: Quantization type for the model (default: "q8")
- `--list-voices`: Display available voices
- `--list-qtypes`: Display available quantization types

### Examples

List available voices:

```bash
deno run --allow-read --allow-write epub.ts --list-voices
```

List quantization types:

```bash
deno run --allow-read --allow-write epub.ts --list-qtypes
```

Generate audiobook with specific voice and quantization:

```bash
deno run --allow-read --allow-write epub.ts --file book.epub --voice en_joe --qtype q4
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
