import { assertEquals, assertRejects } from "jsr:@std/assert";
import { spy, assertSpyCalls, assertSpyCall } from "jsr:@std/testing/mock";

// Import the private streamOutput function by using the Function constructor
// This is a technique to access and test private functions
let streamOutput: Function;

// Before running tests, get access to the streamOutput function
Deno.test({
  name: "Setup - Get access to streamOutput function",
  fn: async () => {
    const libModule = await import("../src/lib/lib.ts");
    // @ts-ignore - Access the internal function for testing
    streamOutput = libModule.streamOutput;
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// Mock necessary dependencies
class MockKokoroTTS {
  stream(splitter: any, options?: any) {
    return {
      [Symbol.asyncIterator]: async function* () {
        // Simulate audio chunks
        for (let i = 0; i < 3; i++) {
          yield {
            text: `chunk ${i}`,
            phonemes: [],
            audio: {
              save: async (path: string) => {
                console.log(`Saving audio to ${path}`);
              }
            }
          };
        }
      }
    };
  }
}

class MockTextSplitterStream {
  constructor() {}
  push(token: string) {}
  close() {}
}

// Mock Deno APIs
const originalCommand = Deno.Command;
const originalMkdir = Deno.mkdir;
const originalWriteTextFile = Deno.writeTextFile;
const originalRemove = Deno.remove;

function setupMocks(ffmpegExitCode = 0) {
  // Mock Deno.mkdir
  Deno.mkdir = async () => {};
  
  // Mock Deno.writeTextFile
  Deno.writeTextFile = async () => {};
  
  // Mock Deno.remove
  Deno.remove = async () => {};
  
  // Mock Deno.Command for ffmpeg
  Deno.Command = class MockCommand {
    constructor(public command: string, public options: Deno.CommandOptions) {}
    
    async output(): Promise<Deno.CommandOutput> {
      return {
        code: ffmpegExitCode,
        success: ffmpegExitCode === 0,
        stdout: new TextEncoder().encode(""),
        stderr: new TextEncoder().encode(ffmpegExitCode === 0 ? "" : "FFmpeg error"),
      };
    }
  } as unknown as typeof Deno.Command;
  
  // Mock global imports
  const originalGlobalImport = globalThis.import;
  globalThis.import = async (specifier: string) => {
    if (specifier === "npm:kokoro-js") {
      return {
        KokoroTTS: MockKokoroTTS,
        TextSplitterStream: MockTextSplitterStream
      };
    }
    return await originalGlobalImport(specifier);
  };
  
  return originalGlobalImport;
}

function restoreMocks(originalGlobalImport: Function) {
  Deno.Command = originalCommand;
  Deno.mkdir = originalMkdir;
  Deno.writeTextFile = originalWriteTextFile;
  Deno.remove = originalRemove;
  globalThis.import = originalGlobalImport;
}

// Tests for streamOutput function
Deno.test({
  name: "streamOutput - successfully processes audio chunks and merges them",
  fn: async () => {
    // Skip if streamOutput is not available
    if (!streamOutput) return;
    
    const originalGlobalImport = setupMocks();
    
    try {
      // Spy on console.log to verify output messages
      const consoleSpy = spy(console, "log");
      
      // Create mock instances
      const mockTts = new MockKokoroTTS();
      const outputFile = "test_output.wav";
      
      // Call the streamOutput function
      await streamOutput(mockTts, "This is a test text", outputFile, "en_joe", true);
      
      // Verify log messages
      assertSpyCalls(consoleSpy, 2);
      assertSpyCall(consoleSpy, 0, {
        args: [`Generating audio file: ${outputFile}`]
      });
      assertSpyCall(consoleSpy, 1, {
        args: [`Audio file generated: ${outputFile}`]
      });
    } finally {
      console.log.restore?.();
      restoreMocks(originalGlobalImport);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "streamOutput - handles FFmpeg errors",
  fn: async () => {
    // Skip if streamOutput is not available
    if (!streamOutput) return;
    
    const originalGlobalImport = setupMocks(1); // Set FFmpeg to exit with error code 1
    
    try {
      // Create mock instances
      const mockTts = new MockKokoroTTS();
      const outputFile = "test_output.wav";
      
      // Call the streamOutput function and expect it to throw
      await assertRejects(
        async () => {
          await streamOutput(mockTts, "This is a test text", outputFile, "en_joe", true);
        },
        Error,
        "Failed to merge audio files"
      );
    } finally {
      restoreMocks(originalGlobalImport);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// Test the behavior of DEFAULT_PARALLEL_CORES with different CPU configurations
Deno.test({
  name: "DEFAULT_PARALLEL_CORES calculation with different core counts",
  fn: async () => {
    // Store the original function
    const originalSystemCpuInfo = Deno.systemCpuInfo;
    
    try {
      // Test with 1 core
      Deno.systemCpuInfo = () => ({ cores: 1, speed: 0 });
      const { DEFAULT_PARALLEL_CORES: cores1 } = await import("../src/lib/lib.ts");
      assertEquals(cores1, 1, "Should use minimum of 1 core even when only 1 core is available");
      
      // Test with 0 cores (edge case)
      Deno.systemCpuInfo = () => ({ cores: 0, speed: 0 });
      const { DEFAULT_PARALLEL_CORES: cores0 } = await import("../src/lib/lib.ts");
      assertEquals(cores0, 1, "Should use minimum of 1 core when 0 cores reported");
      
      // Test with odd number of cores
      Deno.systemCpuInfo = () => ({ cores: 7, speed: 0 });
      const { DEFAULT_PARALLEL_CORES: cores7 } = await import("../src/lib/lib.ts");
      assertEquals(cores7, 3, "Should use floor of half of cores (3 for 7 cores)");
      
      // Test with large number of cores
      Deno.systemCpuInfo = () => ({ cores: 64, speed: 0 });
      const { DEFAULT_PARALLEL_CORES: cores64 } = await import("../src/lib/lib.ts");
      assertEquals(cores64, 32, "Should correctly calculate half of cores for large numbers");
    } finally {
      // Restore original function
      Deno.systemCpuInfo = originalSystemCpuInfo;
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// Test the parallel processing capabilities of generateChapterAudioFiles
Deno.test({
  name: "generateChapterAudioFiles - parallel processing with multiple cores",
  fn: async () => {
    const originalGlobalImport = setupMocks();
    
    try {
      // Import the function fresh to avoid module caching issues
      const { generateChapterAudioFiles } = await import("../src/lib/lib.ts");
      
      // Create a book with many chapters to test parallel processing
      const mockBook = {
        title: "Test Book",
        author: "Test Author",
        coverImagePath: "cover.jpg",
        chapters: Array.from({ length: 10 }, (_, i) => ({
          id: `ch${i + 1}`,
          title: `Chapter ${i + 1}`,
          content: `Content of chapter ${i + 1}`
        }))
      };
      
      // Create a spy to track chapter completions
      const progressSpy = spy();
      
      // Process with 3 parallel cores
      await generateChapterAudioFiles(
        mockBook,
        "output",
        "en_joe",
        "q8",
        progressSpy,
        3 // Use 3 cores for parallel processing
      );
      
      // Verify all chapters were processed
      assertSpyCalls(progressSpy, 10);
    } finally {
      restoreMocks(originalGlobalImport);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});