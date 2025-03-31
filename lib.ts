import { KokoroTTS } from "npm:kokoro-js";
import { 
    Chapter, 
    EPubBook, 
    extractEPub, 
    extractCoverImage 
} from "./parser.ts";

export type { Chapter, EPubBook };
export { extractEPub };

export const AVAILABLE_QTYPES = ["q4", "q8", "fp32", "fp16"] as const;
export type QType = (typeof AVAILABLE_QTYPES)[number];

export const AVAILABLE_AUDIO_FORMATS = ["m4a", "m4b"] as const;
export type AudioFormat = (typeof AVAILABLE_AUDIO_FORMATS)[number];

export async function generateAudioBook(
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
        ffmpegArgs.push(
            "-f",
            "ipod"
        );
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
            `Failed to create ${format.toUpperCase()} audiobook: ${new TextDecoder().decode(stderr)}`
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
