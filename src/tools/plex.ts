import axios from "axios";
import { z } from "zod";

interface PlexLibrary {
  key: string;
  title: string;
  type: string;
  count?: number;
}

interface PlexMetadata {
  title: string;
  type: string;
  year?: number;
  summary?: string;
  duration?: number;
  addedAt?: number;
  viewCount?: number;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
}

interface PlexSession {
  title: string;
  type: string;
  grandparentTitle?: string;
  User?: { title: string };
  Player?: { title: string; platform: string; state: string };
  TranscodeSession?: { videoDecision: string; audioDecision: string; speed: number };
  Media?: Array<{ videoCodec: string; audioCodec: string; Part: Array<{ decision: string }> }>;
}

function getPlexClient() {
  const url = process.env.PLEX_URL;
  const token = process.env.PLEX_TOKEN;
  if (!url || !token) throw new Error("Missing PLEX_URL or PLEX_TOKEN in .env");
  return axios.create({
    baseURL: url,
    headers: { "X-Plex-Token": token, Accept: "application/json" },
    timeout: 15_000,
  });
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const PlexSearchSchema = z.object({
  query: z.string().describe("Search query"),
});

export const PlexRecentlyAddedSchema = z.object({
  limit: z.number().optional().default(20).describe("Number of items to return (default 20)"),
});

export const PlexRefreshLibrarySchema = z.object({
  library_name: z.string().optional().describe("Library name to refresh (e.g. 'Movies'). Refreshes all if omitted."),
});

export const PlexDeleteMediaSchema = z.object({
  rating_key: z.string().describe("Plex ratingKey of the item to delete (from plex_search results)"),
});

export const PlexWatchHistorySchema = z.object({
  limit: z.number().optional().default(20).describe("Number of history entries to return (default 20)"),
  account_id: z.number().optional().describe("Filter by Plex account ID (omit for all users)"),
});

// ─── Implementations ──────────────────────────────────────────────────────────

export async function plexGetLibraries(): Promise<string> {
  const http = getPlexClient();
  const r = await http.get("/library/sections");
  const libs: PlexLibrary[] = r.data?.MediaContainer?.Directory ?? [];
  if (!libs.length) return "No libraries found.";
  return libs
    .map((l) => `[${l.key}] ${l.title} (${l.type})${l.count != null ? ` — ${l.count} items` : ""}`)
    .join("\n");
}

export async function plexSearch(input: z.infer<typeof PlexSearchSchema>): Promise<string> {
  const http = getPlexClient();
  const r = await http.get("/library/search", { params: { query: input.query, limit: 10 } });
  const items: PlexMetadata[] = r.data?.MediaContainer?.Metadata ?? [];
  if (!items.length) return `No results for "${input.query}".`;
  return items
    .map((m) => {
      if (m.type === "episode") {
        return `[Episode] ${m.grandparentTitle} S${m.parentIndex?.toString().padStart(2, "0")}E${m.index?.toString().padStart(2, "0")} — ${m.title}`;
      }
      const dur = m.duration ? ` | ${formatDuration(m.duration)}` : "";
      return `[${m.type}] ${m.title}${m.year ? ` (${m.year})` : ""}${dur}`;
    })
    .join("\n");
}

export async function plexGetSessions(): Promise<string> {
  const http = getPlexClient();
  const r = await http.get("/status/sessions");
  const sessions: PlexSession[] = r.data?.MediaContainer?.Metadata ?? [];
  if (!sessions.length) return "Nobody is watching anything right now.";
  return sessions
    .map((s) => {
      const title = s.grandparentTitle ? `${s.grandparentTitle} — ${s.title}` : s.title;
      const user = s.User?.title ?? "Unknown";
      const player = s.Player ? `${s.Player.platform} (${s.Player.state})` : "Unknown device";
      const transcode = s.TranscodeSession
        ? `transcoding ${s.TranscodeSession.videoDecision}/${s.TranscodeSession.audioDecision} @ ${s.TranscodeSession.speed}x`
        : "direct play";
      return `${user} → ${title}\n  ${player} | ${transcode}`;
    })
    .join("\n\n");
}

export async function plexRecentlyAdded(
  input: z.infer<typeof PlexRecentlyAddedSchema>
): Promise<string> {
  const http = getPlexClient();
  const r = await http.get("/library/recentlyAdded", { params: { "X-Plex-Container-Size": input.limit } });
  const items: PlexMetadata[] = r.data?.MediaContainer?.Metadata ?? [];
  if (!items.length) return "Nothing recently added.";
  return items
    .map((m) => {
      const added = m.addedAt ? new Date(m.addedAt * 1000).toLocaleDateString() : "?";
      if (m.type === "episode") {
        return `${added} | [Episode] ${m.grandparentTitle} — ${m.title}`;
      }
      return `${added} | [${m.type}] ${m.title}${m.year ? ` (${m.year})` : ""}`;
    })
    .join("\n");
}

export async function plexDeleteMedia(input: z.infer<typeof PlexDeleteMediaSchema>): Promise<string> {
  const http = getPlexClient();
  // First fetch the item to confirm it exists and get its title
  const r = await http.get<{ MediaContainer: { Metadata: PlexMetadata[] } }>(`/library/metadata/${input.rating_key}`);
  const item = r.data?.MediaContainer?.Metadata?.[0];
  if (!item) throw new Error(`No item found with ratingKey ${input.rating_key}`);

  await http.delete(`/library/metadata/${input.rating_key}`);
  return `Deleted "${item.title}"${item.year ? ` (${item.year})` : ""} from Plex library.`;
}

export async function plexGetWatchHistory(input: z.infer<typeof PlexWatchHistorySchema>): Promise<string> {
  const http = getPlexClient();
  const params: Record<string, unknown> = { "X-Plex-Container-Size": input.limit };
  if (input.account_id) params.accountID = input.account_id;

  const r = await http.get<{ MediaContainer: { Metadata?: PlexMetadata[] } }>(
    "/status/sessions/history/all",
    { params }
  );
  const items: PlexMetadata[] = r.data?.MediaContainer?.Metadata ?? [];
  if (!items.length) return "No watch history found.";

  return items.map((m) => {
    if (m.type === "episode") {
      return `[Episode] ${m.grandparentTitle} S${String(m.parentIndex ?? 0).padStart(2, "0")}E${String(m.index ?? 0).padStart(2, "0")} — ${m.title}`;
    }
    return `[${m.type}] ${m.title}${m.year ? ` (${m.year})` : ""}${m.viewCount ? ` | ${m.viewCount} play(s)` : ""}`;
  }).join("\n");
}

export async function plexRefreshLibrary(
  input: z.infer<typeof PlexRefreshLibrarySchema>
): Promise<string> {
  const http = getPlexClient();
  const sectionsR = await http.get("/library/sections");
  const libs: PlexLibrary[] = sectionsR.data?.MediaContainer?.Directory ?? [];

  const targets = input.library_name
    ? libs.filter((l) => l.title.toLowerCase() === input.library_name!.toLowerCase())
    : libs;

  if (!targets.length) {
    return `Library "${input.library_name}" not found. Available: ${libs.map((l) => l.title).join(", ")}`;
  }

  await Promise.all(targets.map((l) => http.get(`/library/sections/${l.key}/refresh`)));
  return `Refreshing ${targets.map((l) => l.title).join(", ")}...`;
}
