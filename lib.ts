import { KokoroTTS, TextSplitterStream } from "npm:kokoro-js";
import { Chapter, EPubBook, extractEPub, extractCoverImage } from "./parser.ts";

export type { Chapter, EPubBook };
export { extractEPub };

export const AVAILABLE_QTYPES = ["q4", "q8", "fp32", "fp16"] as const;
export type QType = (typeof AVAILABLE_QTYPES)[number];

export const AVAILABLE_AUDIO_FORMATS = ["m4a", "m4b"] as const;
export type AudioFormat = (typeof AVAILABLE_AUDIO_FORMATS)[number];

async function streamOutput(
  tts: KokoroTTS,
  text: string,
  outputFile: string,
  voice?: string,
  cleanup: boolean = true
) {
  console.log(`Generating audio file: ${outputFile}`);
  
  // Create a subfolder for the chapter audio chunks
  const chapterDir = `${outputFile.substring(0, outputFile.lastIndexOf("."))}_chunks`;
  try {
    await Deno.mkdir(chapterDir, { recursive: true });
  } catch {
    // Ignore if the directory already exists
  }
  
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice });
  
  // Save audio chunks to files and track them
  const chunkFiles: string[] = [];
  let chunkIndex = 0;
  
  const processingPromise = (async () => {
    for await (const { text, phonemes, audio } of stream) {
      const chunkFile = `${chapterDir}/chunk_${String(chunkIndex++).padStart(5, '0')}.wav`;
      await audio.save(chunkFile);
      chunkFiles.push(chunkFile);
    }
    
    // Create a file list for FFmpeg
    const listFile = `${chapterDir}/filelist.txt`;
    const fileList = chunkFiles.map(file => `file '${file}'`).join('\n');
    await Deno.writeTextFile(listFile, fileList);
    
    // Merge all chunk files into a single output file
    const ffmpegCmd = new Deno.Command("ffmpeg", {
      args: [
        "-y",               // Overwrite output file if exists
        "-f", "concat",     // Use concat demuxer
        "-safe", "0",       // Don't require safe filenames
        "-i", listFile,     // Input is our list file
        "-c", "copy",       // Copy codec (no re-encoding)
        outputFile          // Final output file
      ],
      stdout: "piped",
      stderr: "piped",
    });
    
    const { code, stderr } = await ffmpegCmd.output();
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      console.error(`FFmpeg error: ${error}`);
      throw new Error(`Failed to merge audio files: ${error}`);
    }
    
    // Clean up temporary files if requested
    if (cleanup) {
      for (const file of chunkFiles) {
        try {
          await Deno.remove(file);
        } catch (e) {
          console.warn(`Couldn't remove chunk file ${file}: ${e}`);
        }
      }
      try {
        await Deno.remove(listFile);
        await Deno.remove(chapterDir);
      } catch (e) {
        console.warn(`Couldn't clean up chapter directory: ${e}`);
      }
    }
    
    console.log(`Audio file generated: ${outputFile}`);
  })();

  // Push text tokens into the splitter
  const tokens = text.match(/\s*\S+/g) || [];
  for (const token of tokens) {
    splitter.push(token);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Signal no more text will be added
  splitter.close();
  
  // Wait for all audio processing to finish
  await processingPromise;
}

/**
 * Generates audio files for each chapter of the book using the specified TTS model and voice.
 * 
 * @param {EPubBook} book - The book object containing chapters and metadata.
 * @param {string} outputDir - The directory where audio files will be saved.
 * @param {string} voice - The voice to be used for TTS.
 * @param {QType} qtype - The quantization type for the TTS model.
 * @param {boolean} keepChunks - Whether to keep the individual audio chunks (default: false).
 * @returns {Promise<void>} - A promise that resolves when all audio files are generated.
 */
export async function generateChapterAudioFiles(
  book: EPubBook,
  outputDir: string,
  voice: string,
  qtype: QType,
  keepChunks: boolean = false
) {
  const tts = await KokoroTTS.from_pretrained(
    "onnx-community/Kokoro-82M-ONNX",
    { dtype: qtype }
  );

  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch {
    // Ignore if the directory already exists
  }

  console.log(`Processing ${book.title} by ${book.author}`);

  const chapterPromises = book.chapters.map(async (chapter, index) => {
    console.log(`Generating audio for chapter ${index + 1}: ${chapter.title}`);

    const fileName = `${outputDir}/${String(index + 1).padStart(
      3,
      "0"
    )}-${chapter.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wav`;

    return await streamOutput(tts, chapter.content, fileName, voice, !keepChunks);
  });

  // Process all chapters in parallel
  await Promise.all(chapterPromises);
}

export async function generateChapterMetadata(
  book: EPubBook,
  outputDir: string
): Promise<string> {
  const metadataPath = `${outputDir}/chapters.txt`;
  let metadata = ";FFMETADATA1\n"; // FFmpeg metadata header
  let totalDuration = 0;

  for (const [index, chapter] of book.chapters.entries()) {
    const wavFile = `${outputDir}/${String(index + 1).padStart(
      3,
      "0"
    )}-${chapter.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wav`;
    const cmd = new Deno.Command("ffprobe", {
      args: [
        "-i",
        wavFile,
        "-show_entries",
        "format=duration",
        "-v",
        "quiet",
        "-of",
        "csv=p=0",
      ],
    });
    const { stdout } = await cmd.output();
    const duration = parseFloat(new TextDecoder().decode(stdout));

    metadata += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.floor(
      totalDuration * 1000
    )}\n`;
    metadata += `END=${Math.floor((totalDuration + duration) * 1000)}\n`;
    metadata += `title=${chapter.title}\n\n`;

    totalDuration += duration;
  }

  await Deno.writeTextFile(metadataPath, metadata);
  return metadataPath;
}

export async function createAudiobook(
  book: EPubBook,
  epubPath: string,
  outputDir: string,
  format: AudioFormat = "m4a"
) {
  const metadataPath = await generateChapterMetadata(book, outputDir);
  const outputFile = `${outputDir}/${book.title
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}.${format}`;

  // Extract and save cover image
  const coverPath = await extractCoverImage(epubPath, book, outputDir);

  // Create concat file listing all wav files
  const wavFiles = book.chapters
    .map(
      (_, index) =>
        `file '${String(index + 1).padStart(3, "0")}-${book.chapters[
          index
        ].title
          .replace(/[^a-z0-9]/gi, "_")
          .toLowerCase()}.wav'`
    )
    .join("\n");
  const concatPath = `${outputDir}/concat.txt`;
  await Deno.writeTextFile(concatPath, wavFiles);

  // Prepare FFmpeg arguments
  const ffmpegArgs = [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-f",
    "ffmetadata",
    "-i",
    metadataPath,
  ];

  // Add cover image if available
  if (coverPath) {
    ffmpegArgs.push(
      "-i",
      coverPath,
      "-map",
      "2",
      "-disposition:v:0",
      "attached_pic"
    );
  }

  // Add remaining arguments
  ffmpegArgs.push(
    "-map",
    "0:a",
    "-acodec",
    "aac",
    "-b:a",
    "64k",
    "-map_metadata",
    "1",
    "-movflags",
    "+faststart"
  );

  // Add format-specific arguments
  if (format === "m4b") {
    ffmpegArgs.push("-f", "ipod");
  }

  // Add metadata
  ffmpegArgs.push(
    "-metadata",
    `title=${book.title}`,
    "-metadata",
    `artist=${book.author}`,
    outputFile
  );

  // Convert to audiobook with chapter markers and cover
  const cmd = new Deno.Command("ffmpeg", { args: ffmpegArgs });

  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `Failed to create ${format.toUpperCase()} audiobook: ${new TextDecoder().decode(
        stderr
      )}`
    );
  }

  //Cleanup temporary files
  await Deno.remove(concatPath);
  await Deno.remove(metadataPath);
  if (coverPath) {
    await Deno.remove(coverPath);
  }
}

export async function listAvailableVoices(qtype: QType): Promise<void> {
  const tts = await KokoroTTS.from_pretrained(
    "onnx-community/Kokoro-82M-ONNX",
    { dtype: qtype }
  );
  tts.list_voices();
}
