import { assertEquals } from "jsr:@std/assert/equals";
import { assert } from "jsr:@std/assert";
import { Document, DOMParser } from "jsr:@b-fuze/deno-dom";
import { extractChapterTitle, cleanHtml } from "../src/lib/parser.ts";

// Helper function to create a document for testing
function createDocumentFromHTML(html: string): Document | null {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

Deno.test("extractChapterTitle - extracts title from chapter-title class", async () => {
  const html = `
    <html>
      <head><title>Document Title</title></head>
      <body>
        <h1 class="chapter-title">Chapter One: The Beginning</h1>
        <p>This is the content of the chapter.</p>
      </body>
    </html>
  `;
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    undefined,
    "This is the content of the chapter.",
    0
  );
  
  assertEquals(result, "Chapter One: The Beginning");
});

Deno.test("extractChapterTitle - extracts title from chapter-name span", async () => {
  const html = `
    <html>
      <head><title>Document Title</title></head>
      <body>
        <h1 class="chapter-title"><span class="chapter-name">Chapter Two: The Middle</span></h1>
        <p>This is the content of the chapter.</p>
      </body>
    </html>
  `;
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    undefined,
    "This is the content of the chapter.",
    1
  );
  
  assertEquals(result, "Chapter Two: The Middle");
});

Deno.test("extractChapterTitle - extracts title from first heading", async () => {
  const html = `
    <html>
      <head><title>Document Title</title></head>
      <body>
        <h2>Chapter Three: The End</h2>
        <p>This is the content of the chapter.</p>
      </body>
    </html>
  `;
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    undefined,
    "This is the content of the chapter.",
    2
  );
  
  assertEquals(result, "Chapter Three: The End");
});

Deno.test("extractChapterTitle - uses guide title when available", async () => {
  const html = `
    <html>
      <head><title>Document Title</title></head>
      <body>
        <h1>Chapter Title</h1>
        <p>This is the content of the chapter.</p>
      </body>
    </html>
  `;
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    "Guide Title",
    "This is the content of the chapter.",
    3
  );
  
  assertEquals(result, "Guide Title");
});

Deno.test("extractChapterTitle - falls back to head title", async () => {
  const html = `
    <html>
      <head><title>Head Title</title></head>
      <body>
        <p>This is the content of the chapter with no headings.</p>
      </body>
    </html>
  `;
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    undefined,
    "This is the content of the chapter with no headings.",
    4
  );
  
  assert(result.includes("Head Title"));
});

Deno.test("extractChapterTitle - uses chapter + i as last resort", async () => {
  const html = `
    <html>
      <body>
        <p>This is the content of the chapter with no titles at all.</p>
      </body>
    </html>
  `;
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    undefined,
    "This is the content of the chapter with no titles at all.",
    5
  );
  
  assertEquals(result, "Chapter 6");
});

Deno.test("extractChapterTitle - falls back to index-based title when all else fails", async () => {
  const html = `<html><body></body></html>`;
  
  
  const doc = createDocumentFromHTML(html);
  const result = await extractChapterTitle(
    doc,
    undefined,
    "",
    6
  );
  
  assertEquals(result, "Chapter 7");
});

Deno.test("cleanHtml - removes HTML tags and normalizes whitespace", () => {
  const html = `<h1>Title</h1><p>This is a <strong>paragraph</strong> with <em>formatting</em>.</p>
  <p>   Multiple    spaces    should   be   normalized.   </p>`;
  
  const result = cleanHtml(html);
  
  assertEquals(result, "Title This is a paragraph with formatting . Multiple spaces should be normalized.");
});

Deno.test("cleanHtml - decodes HTML entities", () => {
  const html = "This&nbsp;has&amp;entities&lt;like&gt;this&quot;and&#39;that";
  
  const result = cleanHtml(html);
  
  assertEquals(result, "This has&entities<like>this\"and'that");
});