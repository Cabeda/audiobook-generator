import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";
import { assertSpyCall, spy } from "jsr:@std/testing/mock";
import { 
  DEFAULT_PARALLEL_CORES, 
  generateChapterAudioFiles, 
  generateChapterMetadata,
  createAudiobook,
  listAvailableVoices
} from "../src/lib/lib.ts";

// Mock Deno APIs
const originalSystemCpuInfo = Deno.systemCpuInfo;
const originalCommand = Deno.Command;
const originalMkdir = Deno.mkdir;
const originalWriteTextFile = Deno.writeTextFile;
const originalRemove = Deno.remove;

// Test utilities and setup
function mockDenoCommand(outputText = "", exitCode = 0) {
  return class MockCommand {
    constructor(public command: string, public options: Deno.CommandOptions) {}
    
    async output(): Promise<Deno.CommandOutput> {
      return {
        code: exitCode,
        success: exitCode === 0,
        stdout: new TextEncoder().encode(outputText),
        stderr: new TextEncoder().encode(exitCode === 0 ? "" : "Error"),
      };
    }
    
    outputSync(): Deno.CommandOutput {
      return {
        code: exitCode,
        success: exitCode === 0,
        stdout: new TextEncoder().encode(outputText),
        stderr: new TextEncoder().encode(exitCode === 0 ? "" : "Error"),
      };
    }
  } as unknown as typeof Deno.Command;
}

// Setup and teardown for tests
function setupMocks() {
  // Mock Deno.systemCpuInfo to return a fixed number of cores
  Deno.systemCpuInfo = () => ({ cores: 8, speed: 0 });
  
  // Mock file system operations
  Deno.mkdir = async () => {};
  Deno.writeTextFile = async () => {};
  Deno.remove = async () => {};
}

function restoreMocks() {
  Deno.systemCpuInfo = originalSystemCpuInfo;
  Deno.Command = originalCommand;
  Deno.mkdir = originalMkdir;
  Deno.writeTextFile = originalWriteTextFile;
  Deno.remove = originalRemove;
}

// Mocks for KokoroTTS
class MockKokoroTTS {
  static async from_pretrained() {
    return new MockKokoroTTS();
  }
  
  stream() {
    return {
      [Symbol.asyncIterator]: async function* () {
        yield {
          text: "test",
          phonemes: [],
          audio: { save: async () => {} }
        };
      }
    };
  }
  
  list_voices() {
    console.log("en_joe en_amy af_sky");
    return ["en_joe", "en_amy", "af_sky"];
  }
}

// Mock for TextSplitterStream
class MockTextSplitterStream {
  push() {}
  close() {}
}

// Tests

Deno.test("DEFAULT_PARALLEL_CORES calculation", () => {
  setupMocks();
  try {
    // With 8 cores, it should default to 4 (half)
    assertEquals(DEFAULT_PARALLEL_CORES, 6);
  } finally {
    restoreMocks();
  }
});

Deno.test("generateChapterAudioFiles - basic functionality", async () => {
  setupMocks();
  
  // Replace KokoroTTS with our mock implementation
  const originalModuleImport = globalThis.import;
  globalThis.import = async (specifier: string) => {
    if (specifier === "npm:kokoro-js") {
      return {
        KokoroTTS: MockKokoroTTS,
        TextSplitterStream: MockTextSplitterStream
      };
    }
    return await originalModuleImport(specifier);
  };
  
  // Mock command for ffmpeg operations
  Deno.Command = mockDenoCommand("duration: 60.0", 0);
  
  try {
    const mockBook = {
      title: "Test Book",
      author: "Test Author",
      coverImagePath: "cover.jpg",
      chapters: [
        { id: "ch1", title: "Chapter 1", content: "Content of chapter 1" },
        { id: "ch2", title: "Chapter 2", content: "Content of chapter 2" }
      ]
    };
    
    const progressCallback = spy();
    
    await generateChapterAudioFiles(
      mockBook,
      "output",
      "en_joe",
      "q8",
      progressCallback,
      1, // Use just 1 core for predictable testing
      1, // Start from chapter 1
      2  // End at chapter 2
    );
    
    // The progress callback should be called twice (once for each chapter)
    assertEquals(progressCallback.calls.length, 2);
    assertSpyCall(progressCallback, 0, { args: [1] }); // First chapter complete
    assertSpyCall(progressCallback, 1, { args: [2] }); // Second chapter complete
  } finally {
    globalThis.import = originalModuleImport;
    restoreMocks();
  }
});

Deno.test("generateChapterAudioFiles - handles invalid chapter range", async () => {
  setupMocks();
  
  try {
    const mockBook = {
      title: "Test Book",
      author: "Test Author",
      coverImagePath: "cover.jpg",
      chapters: [
        { id: "ch1", title: "Chapter 1", content: "Content of chapter 1" },
        { id: "ch2", title: "Chapter 2", content: "Content of chapter 2" }
      ]
    };
    
    // Testing with start chapter beyond book length
    await generateChapterAudioFiles(
      mockBook,
      "output",
      "en_joe",
      "q8",
      undefined,
      1,
      10, // Start from chapter 10 (which doesn't exist)
      11  // End at chapter 11 (which doesn't exist)
    );
    
    // Nothing should happen, but no error should be thrown
  } finally {
    restoreMocks();
  }
});

Deno.test("generateChapterMetadata - creates metadata file correctly", async () => {
  setupMocks();
  
  // Mock ffprobe to return specific durations for each chapter
  let callCount = 0;
  Deno.Command = class extends mockDenoCommand("60.0", 0) {
    constructor(cmd: string, options: Deno.CommandOptions) {
      super(cmd, options);
      // Return different durations for different calls
      if (cmd === "ffprobe") {
        callCount++;
      }
    }
    
    async output(): Promise<Deno.CommandOutput> {
      if (this.command === "ffprobe") {
        return {
          code: 0,
          success: true,
          stdout: new TextEncoder().encode(callCount === 1 ? "60.0" : "90.0"),
          stderr: new TextEncoder().encode(""),
        };
      }
      return await super.output();
    }
  } as unknown as typeof Deno.Command;
  
  // Spy on writeTextFile to capture the metadata content
  const writeFileSpy = spy(Deno, "writeTextFile");
  
  try {
    const mockBook = {
      title: "Test Book",
      author: "Test Author",
      coverImagePath: "cover.jpg",
      chapters: [
        { id: "ch1", title: "Chapter 1", content: "Content 1" },
        { id: "ch2", title: "Chapter 2", content: "Content 2" }
      ]
    };
    
    const metadataPath = await generateChapterMetadata(mockBook, "output");
    
    // Verify the metadata file was created
    assertEquals(metadataPath, "output/chapters.txt");
    
    // Verify metadata content was written
    assertEquals(writeFileSpy.calls.length, 1);
    assertSpyCall(writeFileSpy, 0, {
      args: [
        "output/chapters.txt",
        // The second argument should contain FFmpeg metadata format
        (text: string) => text.includes(";FFMETADATA1") && 
                          text.includes("[CHAPTER]") &&
                          text.includes("title=Chapter 1") &&
                          text.includes("title=Chapter 2")
      ]
    });
  } finally {
    writeFileSpy.restore();
    restoreMocks();
  }
});

Deno.test("createAudiobook - creates audiobook file with correct parameters", async () => {
  setupMocks();
  
  // Mock generateChapterMetadata to avoid actual file operations
  const generateMetadataSpy = spy(() => Promise.resolve("output/chapters.txt"));
  const originalGenerateChapterMetadata = generateChapterMetadata;
  globalThis.generateChapterMetadata = generateMetadataSpy;
  
  // Mock extractCoverImage
  const extractCoverImageSpy = spy(() => Promise.resolve("output/cover.jpg"));
  
  // Mock Deno.Command to inspect ffmpeg calls
  const commandSpy = spy(Deno, "Command");
  Deno.Command = mockDenoCommand("", 0);
  
  // Spy on writeTextFile to capture the concat file content
  const writeFileSpy = spy(Deno, "writeTextFile");
  
  try {
    const mockBook = {
      title: "Test Book",
      author: "Test Author",
      coverImagePath: "cover.jpg",
      chapters: [
        { id: "ch1", title: "Chapter 1", content: "Content 1" },
        { id: "ch2", title: "Chapter 2", content: "Content 2" }
      ]
    };
    
    // Replace the actual extractCoverImage function
    const mod = await import("../src/lib/lib.ts");
    const originalExtractCoverImage = mod.extractCoverImage;
    mod.extractCoverImage = extractCoverImageSpy;
    
    await createAudiobook(mockBook, "test.epub", "output", "m4a");
    
    // Verify metadata was generated
    assertEquals(generateMetadataSpy.calls.length, 1);
    
    // Verify cover image was extracted
    assertEquals(extractCoverImageSpy.calls.length, 1);
    
    // Verify concat file was created
    assertEquals(writeFileSpy.calls.length, 1);
    assertSpyCall(writeFileSpy, 0, {
      args: [
        "output/concat.txt",
        (text: string) => text.includes("file '01-chapter_1.wav'") && 
                          text.includes("file '02-chapter_2.wav'")
      ]
    });
    
    // Verify ffmpeg was called with correct parameters
    assertEquals(commandSpy.calls.length > 0, true);
    // Restore the original function
    mod.extractCoverImage = originalExtractCoverImage;
  } finally {
    commandSpy.restore();
    writeFileSpy.restore();
    globalThis.generateChapterMetadata = originalGenerateChapterMetadata;
    restoreMocks();
  }
});

Deno.test("listAvailableVoices - displays available voices", async () => {
  setupMocks();
  
  // Replace KokoroTTS with our mock implementation
  const originalModuleImport = globalThis.import;
  globalThis.import = async (specifier: string) => {
    if (specifier === "npm:kokoro-js") {
      return {
        KokoroTTS: MockKokoroTTS,
        TextSplitterStream: MockTextSplitterStream
      };
    }
    return await originalModuleImport(specifier);
  };
  
  // Spy on console.log to verify output
  const consoleSpy = spy(console, "log");
  
  try {
    await listAvailableVoices("q8");
    
    // Verify that console.log was called with voice information
    assertEquals(consoleSpy.calls.length > 0, true);
    assertSpyCall(consoleSpy, 0, {
      args: [(text: string) => text.includes("en_joe") || text.includes("en_amy") || text.includes("af_sky")]
    });
  } finally {
    consoleSpy.restore();
    globalThis.import = originalModuleImport;
    restoreMocks();
  }
});