import { KokoroTTS, TextSplitterStream } from "npm:kokoro-js@1.2.0";
import { Chapter, EPubBook, extractEPub, extractCoverImage } from "./parser.ts";
import os from "node:os";


export type { Chapter, EPubBook };
export { extractEPub };

export const AVAILABLE_QTYPES = ["q4", "q8", "fp32", "fp16"] as const;
export type QType = (typeof AVAILABLE_QTYPES)[number];

export const AVAILABLE_AUDIO_FORMATS = ["m4a", "m4b"] as const;
export type AudioFormat = (typeof AVAILABLE_AUDIO_FORMATS)[number];

// Default to half the available CPU cores, with a minimum of 1
export const DEFAULT_PARALLEL_CORES: number = Math.max(
  1,
  Math.floor(os.availableParallelism() / 2) || 1
);

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
 * Processes a single chapter and generates an audio file.
 * 
 * @param tts KokoroTTS instance
 * @param chapter Chapter data
 * @param outputDir Output directory
 * @param chapterIndex Index of the chapter
 * @param voice Voice to use
 * @returns Promise that resolves when the chapter is processed
 */
async function processChapter(
  tts: KokoroTTS,
  chapter: Chapter,
  outputDir: string,
  chapterIndex: number,
  voice: string
): Promise<number> {
  const fileName = `${outputDir}/${String(chapterIndex + 1).padStart(
    3,
    "0"
  )}-${chapter.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wav`;

  await streamOutput(tts, chapter.content, fileName, voice, true);
  return chapterIndex;
}

/**
 * Generates audio files for each chapter of the book using the specified TTS model and voice.
 * Processes chapters in parallel based on the number of cores specified.
 * 
 * @param {EPubBook} book - The book object containing chapters and metadata.
 * @param {string} outputDir - The directory where audio files will be saved.
 * @param {string} voice - The voice to be used for TTS.
 * @param {QType} qtype - The quantization type for the TTS model.
 * @param {function} progressCallback - Optional callback function to report progress.
 * @param {number} parallelCores - Number of parallel processes to run (defaults to half of available CPU cores).
 * @param {number} startChapter - Optional starting chapter index (1-based)
 * @param {number} endChapter - Optional ending chapter index (1-based)
 * @returns {Promise<void>} - A promise that resolves when all audio files are generated.
 */
export async function generateChapterAudioFiles(
  book: EPubBook,
  outputDir: string,
  voice: string,
  qtype: QType,
  progressCallback?: (chapterIndex: number) => void,
  parallelCores: number = DEFAULT_PARALLEL_CORES,
  startChapter: number = 1,
  endChapter?: number
) {
  // Convert 1-based chapter indices to 0-based array indices
  const startIndex = Math.max(0, startChapter - 1);
  const endIndex = endChapter !== undefined ? Math.min(endChapter - 1, book.chapters.length - 1) : book.chapters.length - 1;
  
  // If invalid range, exit early
  if (startIndex > endIndex || startIndex >= book.chapters.length) {
    console.warn(`Invalid chapter range: ${startChapter} to ${endChapter}. Book has ${book.chapters.length} chapters.`);
    return;
  }
  
  // Get the chapters to process
  const chaptersToProcess = book.chapters.slice(startIndex, endIndex + 1);
  
  // Ensure at least 1 core and not more than available chapters
  parallelCores = Math.max(1, Math.min(parallelCores, chaptersToProcess.length));
  
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
  console.log(`Processing chapters ${startChapter} to ${endChapter || book.chapters.length}`);
  console.log(`Using ${parallelCores} parallel processes for chapter generation`);

  // Keep track of processed chapters and active workers
  let nextChapterIndex = 0;
  let activeWorkers = 0;
  let completedChapters = 0;
  
  // Process chapters in parallel
  const promises: Promise<void>[] = [];
  
  // Function to start a new worker if there are chapters left to process
  const startWorker = async (): Promise<void> => {
    if (nextChapterIndex >= chaptersToProcess.length) return;
    
    const localChapterIndex = nextChapterIndex++;
    const globalChapterIndex = startIndex + localChapterIndex;
    const chapter = chaptersToProcess[localChapterIndex];
    activeWorkers++;
    
    try {
      // Process the chapter
      await processChapter(tts, chapter, outputDir, globalChapterIndex, voice);
      
      // Update progress
      completedChapters++;
      if (progressCallback) {
        progressCallback(completedChapters);
      }
    } catch (error) {
      console.error(`Error processing chapter ${globalChapterIndex + 1}: ${error}`);
      throw error; // Re-throw to be caught by the main promise
    } finally {
      activeWorkers--;
      
      // Start a new worker if there are more chapters to process
      if (nextChapterIndex < chaptersToProcess.length) {
        promises.push(startWorker());
      }
    }
  };
  
  // Start initial batch of workers
  for (let i = 0; i < parallelCores; i++) {
    promises.push(startWorker());
  }
  
  // Wait for all chapters to be processed
  await Promise.all(promises);
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
  let coverPath: string | null = null;
  try {
    coverPath = await extractCoverImage(epubPath, book, outputDir);
    
    // Check if cover exists and if so, convert it to a compatible format
    if (coverPath) {
      const compatibleCoverPath = `${outputDir}/cover_compatible.jpg`;
      // Convert the image to JPEG format which is more compatible with M4B/M4A
      const imgCmd = new Deno.Command("ffmpeg", {
        args: [
          "-y",
          "-i", coverPath,
          "-vf", "scale=800:-1",  // Resize to reasonable dimensions
          "-q:v", "2",            // High quality JPEG
          compatibleCoverPath
        ],
      });
      
      const imgResult = await imgCmd.output();
      if (imgResult.code === 0) {
        // If conversion succeeds, use the compatible cover
        await Deno.remove(coverPath);
        coverPath = compatibleCoverPath;
      } else {
        console.warn("Failed to convert cover image to compatible format. Proceeding without cover.");
        coverPath = null;
      }
    }
  } catch (error) {
    console.warn(`Cover image processing failed: ${error}. Proceeding without cover.`);
    coverPath = null;
  }

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
    "-y",                // Overwrite output files
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-f", "ffmetadata",
    "-i", metadataPath,
  ];

  // Add cover image if available
  if (coverPath) {
    ffmpegArgs.push(
      "-i", coverPath,
      "-map", "0:a",     // First map audio from the first input
      "-map", "2:v",     // Then map video (cover) from the third input
      "-c:v", "mjpeg",   // Use MJPEG codec for the cover which is widely compatible
      "-disposition:v:0", "attached_pic"
    );
  } else {
    ffmpegArgs.push("-map", "0:a"); // Only map audio if no cover
  }

  // Add remaining arguments
  ffmpegArgs.push(
    "-acodec", "aac",
    "-b:a", "64k",
    "-map_metadata", "1",
    "-movflags", "+faststart"
  );

  // Add format-specific arguments
  if (format === "m4b") {
    ffmpegArgs.push("-f", "ipod");
  }

  // Add metadata
  ffmpegArgs.push(
    "-metadata", `title=${book.title}`,
    "-metadata", `artist=${book.author}`,
    outputFile
  );

  // Convert to audiobook with chapter markers and cover
  console.log(`Creating ${format} audiobook: ${outputFile}`);
  const cmd = new Deno.Command("ffmpeg", { args: ffmpegArgs });

  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    const errorOutput = new TextDecoder().decode(stderr);
    console.error(`FFmpeg error output: ${errorOutput}`);
    throw new Error(
      `Failed to create ${format.toUpperCase()} audiobook: ${errorOutput}`
    );
  }

  console.log(`Successfully created audiobook: ${outputFile}`);

  // Cleanup temporary files
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
  tts.list_voices()
}
