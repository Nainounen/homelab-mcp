import { z } from "zod";
import { ArrClient } from "../arr.js";
import { bytes, getFirstQualityProfileId } from "../utils.js";

interface ReadarrBook {
  id: number;
  title: string;
  authorTitle: string;
  grabbed: boolean;
  sizeOnDisk?: number;
  monitored: boolean;
}

interface ReadarrQueueItem {
  id: number;
  title: string;
  status: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
}

export const ReadarrSearchSchema = z.object({
  title: z.string().describe("Book or author title to search for"),
});

export const ReadarrAddBookSchema = z.object({
  goodreads_id: z.string().optional().describe("Goodreads book ID (from readarr_search_book)"),
  title: z.string().optional().describe("Book title (auto-lookup if goodreads_id not provided)"),
  quality_profile: z.string().optional().describe("Quality profile name (default: first available)"),
});

export async function readarrSearchBook(
  client: ArrClient,
  input: z.infer<typeof ReadarrSearchSchema>
): Promise<string> {
  const results = await client.get<Array<{
    id?: number;
    foreignBookId?: string;
    title: string;
    authorTitle?: string;
    overview?: string;
  }>>("/book/lookup", { term: input.title });

  if (!results.length) return "No results found.";
  return results.slice(0, 8).map((b) => {
    const author = b.authorTitle ? ` — ${b.authorTitle}` : "";
    return `[${b.foreignBookId ?? b.id}] ${b.title}${author}`;
  }).join("\n");
}

export async function readarrListBooks(client: ArrClient): Promise<string> {
  const books = await client.get<ReadarrBook[]>("/book");
  if (!books.length) return "No books in Readarr library.";
  return [...books]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((b) => {
      const status = b.grabbed ? `✓ ${bytes(b.sizeOnDisk ?? 0)}` : b.monitored ? "missing" : "unmonitored";
      return `[${b.id}] ${b.title} (${b.authorTitle}) — ${status}`;
    }).join("\n");
}

export async function readarrGetQueue(client: ArrClient): Promise<string> {
  const q = await client.get<{ records: ReadarrQueueItem[] }>("/queue");
  if (!q.records.length) return "No active downloads in Readarr queue.";
  return q.records.map((item) => {
    const pct = item.size > 0 ? (((item.size - item.sizeleft) / item.size) * 100).toFixed(1) : "?";
    return `[${item.id}] ${item.title}\n  ${item.status} | ${pct}% | ETA: ${item.timeleft ?? "unknown"}`;
  }).join("\n\n");
}

export async function readarrAddBook(
  client: ArrClient,
  input: z.infer<typeof ReadarrAddBookSchema>
): Promise<string> {
  const rootFolder = process.env.READARR_ROOT_FOLDER;
  if (!rootFolder) throw new Error("READARR_ROOT_FOLDER is not set in .env");

  const results = await client.get<Array<{ foreignBookId: string; title: string; authorTitle?: string }>>(
    "/book/lookup",
    { term: input.goodreads_id ? `readarr:${input.goodreads_id}` : input.title }
  );
  if (!results.length) throw new Error("Book not found");

  const profileId = await getFirstQualityProfileId(client, "Readarr");
  const book      = results[0];

  await client.post("/book", {
    foreignBookId: book.foreignBookId,
    title: book.title,
    qualityProfileId: profileId,
    rootFolderPath: rootFolder,
    monitored: true,
    addOptions: { searchForNewBook: true },
  });

  return `Added "${book.title}" to Readarr.`;
}
