import { readZip } from "https://deno.land/x/jszip@0.11.0/mod.ts";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { pipeline } from "npm:@huggingface/transformers";

export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface EPubBook {
  title: string;
  coverImagePath: string;
  author: string;
  chapters: Chapter[];
}

export function cleanHtml(html: string): string {
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

export async function extractChapterTitle(
  pipe: any,
  chapterDoc: Document | null,
  guideTitle: string | undefined,
  chapterContent: string,
  index: number
): Promise<string> {
  // First try to get title from metadata
  const newTitle = chapterDoc
    ?.querySelector("head")
    ?.querySelector("title")?.textContent;
  
  // Try multiple strategies to find the chapter title
  const body = chapterDoc?.querySelector("body");
  
  // Strategy 1: Look for specific class structure (chapter-title/chapter-name)
  const chapterTitleElement = body?.querySelector("h1.chapter-title");
  const chapterNameSpan = chapterTitleElement?.querySelector("span.chapter-name");
  const chapterTitleFromStructure = chapterNameSpan?.textContent || chapterTitleElement?.textContent;
  
  // Strategy 2: Look for any heading elements in order of priority
  const headings = [
      // Direct headings under body
      body?.querySelector("h1")?.textContent,
      body?.querySelector("h2")?.textContent,
      body?.querySelector("h3")?.textContent,
      
      // Headings inside sections
      body?.querySelector("section h1")?.textContent,
      body?.querySelector("section h2")?.textContent,
      body?.querySelector("section h3")?.textContent,
      
      // Any other heading anywhere in the document
      chapterDoc?.querySelector("h1")?.textContent,
      chapterDoc?.querySelector("h2")?.textContent,
      chapterDoc?.querySelector("h3")?.textContent
  ].filter(Boolean); // Remove nulls and undefined
  
  const headingTitle = headings.length > 0 ? headings[0] : null;
  
  const title =
      guideTitle ||
      cleanHtml(chapterTitleFromStructure || headingTitle || chapterDoc?.querySelector("title")?.textContent || "");

  const contentPreview = chapterContent.slice(0, 500);
  const prompt = `${contentPreview}`;

  const out = await pipe(prompt, {
    max_length: 50,
    min_length: 2,
  });

  const result = Array.isArray(out) ? out[0] : out;

  const generatedTitle = result.summary_text;

  return newTitle || title || generatedTitle || `Chapter ${index + 1}`;
}

export async function extractEPub(filePath: string): Promise<EPubBook> {
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

export async function extractCoverImage(
  epubPath: string,
  book: EPubBook,
  outputDir: string
): Promise<string | null> {
  if (!book.coverImagePath) return null;

  const zip = await readZip(epubPath);
  const coverData = await zip.file(book.coverImagePath)?.async("uint8array");
  if (!coverData) return null;

  const coverFile = `${outputDir}/cover.jpg`;
  await Deno.writeFile(coverFile, coverData);
  return coverFile;
}
