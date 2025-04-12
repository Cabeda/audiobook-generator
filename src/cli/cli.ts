import {
  AVAILABLE_QTYPES,
  QType,
  AVAILABLE_AUDIO_FORMATS,
  DEFAULT_PARALLEL_CORES,
  AudioFormat,
  extractEPub,
  generateChapterAudioFiles,
  createAudiobook,
  listAvailableVoices
} from "../lib/lib.ts";

// Progress bar class to track and display progress
class ProgressBar {
  total: number;
  current: number;
  barLength: number;
  startTime: number;
  lastUpdateTime: number;
  processingRates: number[];
  stage: string;
  interval: number | null;
  animation: string[];
  animationIndex: number;

  constructor(total: number, barLength = 40) {
    this.total = total;
    this.current = 0;
    this.barLength = barLength;
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.processingRates = [];
    this.stage = "Initializing";
    this.interval = null;
    this.animation = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.animationIndex = 0;
    
    // Start the animation loop
    this.startAnimation();
  }

  startAnimation(): void {
    // Clear any existing interval
    if (this.interval !== null) {
      clearInterval(this.interval);
    }
    
    // Update animation every 100ms
    this.interval = setInterval(() => {
      this.animationIndex = (this.animationIndex + 1) % this.animation.length;
      this.render();
    }, 100);
  }

  stopAnimation(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  setStage(stage: string): void {
    this.stage = stage;
    this.render();
  }

  update(current = this.current + 1): void {
    const now = Date.now();
    const timeDelta = now - this.lastUpdateTime;
    
    if (timeDelta > 0) {
      // Calculate items processed per second
      const rate = 1000 / timeDelta;
      this.processingRates.push(rate);
      
      // Keep only the last 5 rates for a moving average
      if (this.processingRates.length > 5) {
        this.processingRates.shift();
      }
    }
    
    this.current = current;
    this.lastUpdateTime = now;
    this.render();
  }

  render(): void {
    // Calculate progress percentage
    const percent = (this.current / this.total) * 100;
    const filledLength = Math.round((this.barLength * this.current) / this.total);
    const emptyLength = this.barLength - filledLength;
    
    // Create the progress bar visual
    const filledBar = "█".repeat(filledLength);
    const emptyBar = "░".repeat(emptyLength);
    const progressBar = `${filledBar}${emptyBar}`;
    
    // Calculate estimated time remaining
    let etaString = "calculating...";
    if (this.processingRates.length > 0) {
      const avgRate = this.processingRates.reduce((a, b) => a + b, 0) / this.processingRates.length;
      const itemsRemaining = this.total - this.current;
      const secondsRemaining = itemsRemaining / avgRate;
      
      if (secondsRemaining < 60) {
        etaString = `${Math.round(secondsRemaining)}s`;
      } else if (secondsRemaining < 3600) {
        etaString = `${Math.floor(secondsRemaining / 60)}m ${Math.round(secondsRemaining % 60)}s`;
      } else {
        etaString = `${Math.floor(secondsRemaining / 3600)}h ${Math.floor((secondsRemaining % 3600) / 60)}m`;
      }
    }
    
    // Calculate elapsed time
    const elapsedMs = Date.now() - this.startTime;
    let elapsedString = "";
    if (elapsedMs < 60000) {
      elapsedString = `${Math.round(elapsedMs / 1000)}s`;
    } else if (elapsedMs < 3600000) {
      elapsedString = `${Math.floor(elapsedMs / 60000)}m ${Math.round((elapsedMs % 60000) / 1000)}s`;
    } else {
      elapsedString = `${Math.floor(elapsedMs / 3600000)}h ${Math.floor((elapsedMs % 3600000) / 60000)}m`;
    }
    
    // Get current animation frame
    const spinner = this.animation[this.animationIndex];
    
    // Clear the console and redraw (works better for dynamic updates)
    console.clear();
    console.log(`Stage: ${this.stage} ${spinner}`);
    console.log(`[${progressBar}] ${percent.toFixed(1)}% | ${this.current}/${this.total} chapters`);
    console.log(`Elapsed: ${elapsedString} | ETA: ${etaString}`);
  }

  finish(): void {
    this.stopAnimation();
    this.current = this.total;
    this.render();
    console.log(""); // Add an empty line after completion
  }
}

export async function main() {
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
    const cores = args.get("cores")
      ? parseInt(args.get("cores"))
      : DEFAULT_PARALLEL_CORES;
    
    // Parse chapter range options
    const startChapter = args.get("start-chapter") ? parseInt(args.get("start-chapter")) : 1;
    const endChapter = args.get("end-chapter") ? parseInt(args.get("end-chapter")) : undefined;
    
    if (isNaN(startChapter) || startChapter < 1) {
      throw new Error("Start chapter must be a positive integer");
    }
    
    if (endChapter !== undefined && (isNaN(endChapter) || endChapter < startChapter)) {
      throw new Error("End chapter must be a number greater than or equal to start chapter");
    }
    
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
    
    if (isNaN(cores) || cores < 1) {
      throw new Error("Number of cores must be a positive integer");
    }
    
    console.log("Extracting EPUB file...");
    const book = await extractEPub(epubPath);
    console.log("Book extracted successfully");
    const outputDir = new URL(`./output/${book.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`, import.meta.url).pathname;

    // Calculate how many chapters will be processed
    const startIndex = Math.max(0, startChapter - 1);
    const endIndex = endChapter !== undefined ? Math.min(endChapter - 1, book.chapters.length - 1) : book.chapters.length - 1;
    
    // Calculate chapters to process and validate the range
    if (startIndex > endIndex || startIndex >= book.chapters.length) {
      throw new Error(`Invalid chapter range: ${startChapter} to ${endChapter}. Book has ${book.chapters.length} chapters.`);
    }
    
    const chaptersToProcess = endIndex - startIndex + 1;

    // Initialize progress bar with the number of chapters that will be processed
    const progressBar = new ProgressBar(chaptersToProcess);
    
    // Update the generateChapterAudioFiles call to include progress tracking and parallel processing
    progressBar.setStage("Generating audio files");
    await generateChapterAudioFiles(
      book, 
      outputDir, 
      voice, 
      qtype as QType,
      (chapterIndex) => {
        progressBar.update(chapterIndex);
      },
      cores,
      startChapter,
      endChapter
    );
    
    // Mark the audio generation as complete
    progressBar.finish();
    console.log("Audio generation completed");

    console.log("Creating audiobook...");
    await createAudiobook(book, epubPath, outputDir, format as AudioFormat);
    console.log(`${format.toUpperCase()} audiobook created successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error:", errorMessage);
    console.log("\nUsage:");
    console.log(
      "audiobook-generator --file <epub-file> [--voice <voice>] [--qtype <qtype>] [--format <format>] [--cores <num>] [--start-chapter <num>] [--end-chapter <num>] [--list-voices] [--list-qtypes] [--list-formats]"
    );
  }
}

if (import.meta.main) {
  await main();
}
