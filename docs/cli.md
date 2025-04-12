# CLI Documentation

The Audiobook Generator CLI allows you to convert EPUB books into audiobooks with various options for customization.

## Usage

```bash
deno run --allow-read --allow-write src/cli/cli.ts --file <path-to-epub> [options]
```

## Options

- `--file` or `-f`: Path to the EPUB file (required).
- `--voice`: Voice to use for TTS (default: "af_sky").
- `--qtype`: Quantization type for the model (default: "q8").
- `--format`: Audio format to generate (default: "m4a", options: "m4a", "m4b").
- `--cores`: Number of parallel processes to use (default: half of available CPU cores).
- `--start-chapter`: First chapter to process (default: 1).
- `--end-chapter`: Last chapter to process (default: process all chapters).
- `--list-voices`: Display available voices.
- `--list-qtypes`: Display available quantization types.
- `--list-formats`: Display available audio formats.

## Examples

### List Available Voices

```bash
deno run --allow-read --allow-write src/cli/cli.ts --list-voices
```

### Generate Audiobook with Specific Voice and Quantization

```bash
deno run --allow-read --allow-write src/cli/cli.ts --file book.epub --voice en_joe --qtype q4
```

### Process Only Chapters 5 to 10

```bash
deno run --allow-read --allow-write src/cli/cli.ts --file book.epub --start-chapter 5 --end-chapter 10
```

### Generate Audiobook with Custom Audio Format

```bash
deno run --allow-read --allow-write src/cli/cli.ts --file book.epub --format m4b
```

## Error Handling

- If `--file` is not provided, the CLI will throw an error: `Please provide an EPUB file path using --file or -f`.
- If `--start-chapter` is greater than `--end-chapter`, the CLI will throw an error: `End chapter must be a number greater than or equal to start chapter`.
- If invalid options are provided for `--qtype` or `--format`, the CLI will display the available options and exit.

## Output

The CLI generates the following:

1. Individual WAV files for each chapter.
2. A final audiobook file in the specified format (e.g., M4A or M4B).
3. All output files are saved in the `output/<book-title>` directory.