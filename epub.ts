import { readZip } from "https://deno.land/x/jszip@0.11.0/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import { KokoroTTS } from "npm:kokoro-js";
import { pipeline } from "npm:@huggingface/transformers";

interface Chapter {
  id: string;
  title: string;
  content: string;
}

interface EPubBook {
  title: string;
  coverImagePath: string;
  author: string;
  chapters: Chapter[];
}

function cleanHtml(html: string): string {
  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ");
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Clean up whitespace
  return text.replace(/\s+/g, " ").trim();
}

async function extractChapterTitle(
  pipe: any,
  chapterDoc: Document | null,
  guideTitle: string | undefined,
  chapterContent: string,
  index: number
): Promise<string> {
  // First try to get title from metadata
  const title =
    guideTitle ||
    cleanHtml(chapterDoc?.querySelector("title")?.textContent || "");
 
  try {
    
    // const contentPreview = chapterContent.slice(0, 1000);
    // Create a clear instruction for the model
    // const prompt = `${contentPreview}`;
    
    // const out = await pipe(prompt, {
    //   max_length: 50,
    //   min_length: 2,
    // });

    // const result = Array.isArray(out) ? out[0] : out;
    // if (result && result.score > 0.8) {
    //   // Clean up the generated title
    //   const generatedTitle = result.answer
    //     .replace(/^chapter\s+\d+:?\s*/i, '')
    //     .trim();
      
    //   if (generatedTitle) {
    //     title = generatedTitle;
    //   }
    // }
  } catch (error) {
    console.warn(`Failed to generate title for chapter ${index + 1}:`, error);
  }

  return title || `Chapter ${index + 1}`;
}

async function extractEPub(filePath: string): Promise<EPubBook> {
  const zip = await readZip(filePath);
  const pipe = await pipeline("summarization", "Xenova/t5-small");

  // Find and parse container.xml to get content.opf location
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml!, "text/html");
  const contentPath =
    containerDoc?.querySelector("rootfile")?.getAttribute("full-path") || "";

  // Parse content.opf
  const contentOpf = await zip.file(contentPath)?.async("text");
  const contentDoc = parser.parseFromString(contentOpf!, "text/html");

  // Extract metadata
  const title =
    contentDoc?.querySelector("title, dc\\:title, title")?.textContent ||
    "Unknown";
  const author =
    contentDoc?.querySelector("creator, dc\\:creator, author")?.textContent ||
    "Unknown";
  const coverImageId =
    contentDoc?.querySelector("meta[name='cover']")?.getAttribute("content") ||
    "cover-image";
  const coverImagePath =
    contentDoc
      ?.querySelector(`item[id='${coverImageId}']`)
      ?.getAttribute("href") || "";

  // Get spine and manifest items
  const spine = Array.from(contentDoc?.querySelectorAll("itemref") || []);
  const manifest = new Map(
    Array.from(contentDoc?.querySelectorAll("item") || []).map((item) => [
      item.getAttribute("id"),
      item.getAttribute("href"),
    ])
  );

  // Get the base directory from content.opf path
  const baseDir = contentPath.split("/").slice(0, -1).join("/");

  // Create a map of chapter IDs to their titles from guide references
  const chapterTitles = new Map(
    Array.from(contentDoc?.querySelectorAll("guide reference") || []).map(
      (ref) => [
        ref.getAttribute("href")?.split(".")[0] || "", // e.g., "Chapter01" from "Chapter01.html#ch1"
        ref.getAttribute("title") || "",
      ]
    )
  );

  // Extract chapters
  const chapters: Chapter[] = [];
  for (const [index, item] of spine.entries()) {
    const id = item.getAttribute("idref") || "";
    const href = manifest.get(id);
    if (href) {
      // Combine base directory with href to get full path
      const fullPath = baseDir ? `${baseDir}/${href}` : href;
      const chapterContent = await zip.file(fullPath)?.async("text");
      const chapterDoc = parser.parseFromString(chapterContent!, "text/html");

      const content = cleanHtml(
        chapterDoc?.querySelector("body")?.innerHTML || ""
      );

      const guideTitle = chapterTitles.get(id);
      const title = await extractChapterTitle(
        pipe,
        chapterDoc,
        guideTitle,
        content!,
        index
      );


      if (content) {
        chapters.push({
          id: `chapter-${index + 1}`,
          title,
          content,
        });
      }
    }
  }

  return {
    title,
    coverImagePath,
    author,
    chapters,
  };
}

const AVAILABLE_QTYPES = ["q4", "q8", "fp32", "fp16"] as const;
type QType = (typeof AVAILABLE_QTYPES)[number];

async function generateAudioBook(
  book: EPubBook,
  outputDir: string,
  voice: string,
  qtype: QType
) {
  const tts = await KokoroTTS.from_pretrained(
    "onnx-community/Kokoro-82M-ONNX",
    { dtype: qtype }
  );

  // Create output directory if it doesn't exist
  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  console.log(`Processing ${book.title} by ${book.author}`);

  for (const [index, chapter] of book.chapters.entries()) {
    console.log(`Generating audio for chapter ${index + 1}: ${chapter.title}`);

    // Process each chunk and combine into one audio file
    const chapterAudio = await tts.generate(chapter.content, {
      voice: voice,
    });

    const fileName = `${outputDir}/${String(index + 1).padStart(
      3,
      "0"
    )}-${chapter.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wav`;
    await chapterAudio.save(fileName);
  }
}

async function generateChapterMetadata(
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

async function extractCoverImage(
  zip: any,
  book: EPubBook,
  outputDir: string
): Promise<string | null> {
  if (!book.coverImagePath) return null;

  const coverData = await zip.file(book.coverImagePath)?.async("uint8array");
  if (!coverData) return null;

  const coverFile = `${outputDir}/cover.jpg`;
  await Deno.writeFile(coverFile, coverData);
  return coverFile;
}

async function createM4bAudiobook(book: EPubBook, epubPath: string, outputDir: string) {
  const metadataPath = await generateChapterMetadata(book, outputDir);
  const outputFile = `${outputDir}/${book.title
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}.m4b`;

  // Extract and save cover image
  const zip = await readZip(epubPath);
  const coverPath = await extractCoverImage(zip, book, outputDir);

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

  //TODO: Add cover image if available
  // if (coverPath) {
  //   ffmpegArgs.push(
  //     "-i",
  //     coverPath,
  //     "-map",
  //     "2",
  //     "-disposition:v:0",
  //     "attached_pic"
  //   );
  // }

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
    "+faststart",
    "-f",
    "ipod",
    "-metadata",
    `title=${book.title}`,
    "-metadata",
    `artist=${book.author}`,
    outputFile
  );

  // Convert to M4B with chapter markers and cover
  const cmd = new Deno.Command("ffmpeg", { args: ffmpegArgs });

  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `Failed to create M4B audiobook: ${new TextDecoder().decode(stderr)}`
    );
  }

  // Cleanup temporary files
  // await Deno.remove(concatPath);
  // await Deno.remove(metadataPath);
  // if (coverPath) {
  //   await Deno.remove(coverPath);
  // }
}

// Usage example
if (import.meta.main) {
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
      const tts = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-ONNX",
        { dtype: args.get("qtype") || "q8" }
      );
      tts.list_voices();

      Deno.exit(0);
    }

    const epubPath = args.get("file") || args.get("f");
    if (!epubPath) {
      throw new Error("Please provide an EPUB file path using --file or -f");
    }

    const voice = args.get("voice") || "af_sky";
    const qtype = args.get("qtype") || "q8";
    
    if (!AVAILABLE_QTYPES.includes(qtype as QType)) {
      throw new Error(
        `Invalid qtype. Use --list-qtypes to see available options`
      );
    }
    
    const book = await extractEPub(epubPath);
    console.log("Book extracted successfully");
    const outputDir = new URL(`./output/${book.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`, import.meta.url).pathname;

    await generateAudioBook(book, outputDir, voice, qtype as QType);
    console.log("Audio generation completed");

    await createM4bAudiobook(book, epubPath, outputDir);
    console.log("M4B audiobook created successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error:", errorMessage);
    console.log("\nUsage:");
    console.log(
      "deno run --allow-read --allow-write epub.ts [--voice <voice>] [--qtype <qtype>] [--list-voices] [--list-qtypes] <epub-file>"
    );
  }
}
