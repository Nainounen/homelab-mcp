import { ToolModule } from "../types.js";
import { ArrClient } from "../arr.js";
import * as impl from "../tools/readarr.js";

export function readarrModule(client: ArrClient): ToolModule {
  return {
    domain: "Readarr",
    tools: [
      {
        name: "readarr_search_book",
        description: "Search for a book by title or author. Returns Goodreads IDs. Use before readarr_add_book.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", description: "Book title or author to search for" } },
          required: ["title"],
        },
      },
      {
        name: "readarr_add_book",
        description: "Add a book to Readarr and trigger an automatic download search.",
        inputSchema: {
          type: "object",
          properties: {
            goodreads_id: { type: "string", description: "Goodreads book ID (from readarr_search_book)" },
            title: { type: "string", description: "Book title (auto-lookup if goodreads_id not provided)" },
            quality_profile: { type: "string", description: "Quality profile name (default: first available)" },
          },
        },
      },
      {
        name: "readarr_list_books",
        description: "List all books in the Readarr library with download status and file size.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "readarr_get_queue",
        description: "Show active and queued book downloads in Readarr with progress and ETA.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "readarr_search_book": return impl.readarrSearchBook(client, impl.ReadarrSearchSchema.parse(args));
        case "readarr_add_book":    return impl.readarrAddBook(client, impl.ReadarrAddBookSchema.parse(args));
        case "readarr_list_books":  return impl.readarrListBooks(client);
        case "readarr_get_queue":   return impl.readarrGetQueue(client);
        default: return null;
      }
    },
  };
}
