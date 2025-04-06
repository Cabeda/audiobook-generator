import { readZip } from "https://deno.land/x/jszip@0.11.0/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
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
