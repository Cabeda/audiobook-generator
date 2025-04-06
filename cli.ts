import {
  AVAILABLE_QTYPES,
  QType,
  AVAILABLE_AUDIO_FORMATS,
  AudioFormat,
  extractEPub,
  generateChapterAudioFiles,
  createAudiobook,
  listAvailableVoices
} from "./lib.ts";

async function main() {
  try {
    const args = new Map();
    for (let i = 0; i < Deno.args.length; i++) {
      if (Deno.args[i].startsWith("--")) {
        const key = Deno.args[i].slice(2);
        const value = Deno.args[i + 1];
        if (value && !value.startsWith("--")) {
          args.set(key, value);
          i++; // Skip next argument since it's the value
        } else {
          args.set(key, true);
        }
      }
    }

    if (args.has("list-qtypes")) {
      console.log("Available quantization types:");
      console.log(AVAILABLE_QTYPES.join("\n"));
      Deno.exit(0);
    }

    if (args.has("list-voices")) {
      console.log("Available voices:");
      await listAvailableVoices(args.get("qtype") as QType || "q8");
      Deno.exit(0);
    }
    
    if (args.has("list-formats")) {
      console.log("Available audio formats:");
      console.log(AVAILABLE_AUDIO_FORMATS.join("\n"));
      Deno.exit(0);
    }

    const epubPath = args.get("file") || args.get("f");
    if (!epubPath) {
      throw new Error("Please provide an EPUB file path using --file or -f");
    }

    const voice = args.get("voice") || "af_sky";
    const qtype = args.get("qtype") || "q8";
    const format = args.get("format") || "m4a";
    
    if (!AVAILABLE_QTYPES.includes(qtype as QType)) {
      throw new Error(
        `Invalid qtype. Use --list-qtypes to see available options`
      );
    }
    
    if (!AVAILABLE_AUDIO_FORMATS.includes(format as AudioFormat)) {
      throw new Error(
        `Invalid format. Use --list-formats to see available options`
      );
    }
    
    const book = await extractEPub(epubPath);
    console.log("Book extracted successfully");
    const outputDir = new URL(`./output/${book.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`, import.meta.url).pathname;

    await generateChapterAudioFiles(book, outputDir, voice, qtype as QType);
    console.log("Audio generation completed");

    await createAudiobook(book, epubPath, outputDir, format as AudioFormat);
    console.log(`${format.toUpperCase()} audiobook created successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error:", errorMessage);
    console.log("\nUsage:");
    console.log(
      "deno run --allow-read --allow-write cli.ts --file <epub-file> [--voice <voice>] [--qtype <qtype>] [--format <format>] [--list-voices] [--list-qtypes] [--list-formats]"
    );
  }
}

if (import.meta.main) {
  await main();
}
