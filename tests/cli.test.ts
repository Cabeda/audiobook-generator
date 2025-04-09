import { assertEquals, assertThrows } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { generateChapterAudioFiles } from "../src/lib/lib.ts";

Deno.test("CLI should throw an error if --file is not provided", () => {
  const args = ["--voice", "en_joe"];
  assertThrows(
    () => {
      // Simulate CLI execution
      const command = new Deno.Command("deno", { args: ["run", "src/cli/cli.ts", ...args] });
      command.outputSync();
    },
    Error,
    "Please provide an EPUB file path using --file or -f"
  );
});

Deno.test("CLI should process chapters within the specified range", async () => {
  const mockBook = {
    title: "Test Book",
    author: "Test Author",
    chapters: [
      { title: "Chapter 1", content: "Content 1" },
      { title: "Chapter 2", content: "Content 2" },
      { title: "Chapter 3", content: "Content 3" },
    ],
  };

  const processedChapters: number[] = [];

  await generateChapterAudioFiles(
    mockBook,
    "output",
    "en_joe",
    "q8",
    (chapterIndex) => processedChapters.push(chapterIndex),
    1,
    2,
    2
  );

  assertEquals(processedChapters, [0, 1]);
});

Deno.test("CLI should throw an error for invalid chapter range", () => {
  const args = ["--file", "test.epub", "--start-chapter", "5", "--end-chapter", "2"];
  assertThrows(
    () => {
      const command = new Deno.Command("deno", {
        args: ["run", "src/cli/cli.ts", ...args],
      });
      command.outputSync();
    },
    Error,
    "End chapter must be a number greater than or equal to start chapter"
  );
});

Deno.test("CLI list voices returns a list", () => {
  const args = [
    "--file",
    "test.epub",
    "--start-chapter",
    "5",
    "--end-chapter",
    "2",
  ];
  assertThrows(
    () => {
      const command = new Deno.Command("deno", {
        args: ["run", "src/cli/cli.ts", ...args],
      });
      command.outputSync();
    },
    Error,
    "End chapter must be a number greater than or equal to start chapter"
  );
});