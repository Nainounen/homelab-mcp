import { z } from "zod";
import { ArrClient } from "../arr.js";
import { bytes, getFirstQualityProfileId, QualityProfile } from "../utils.js";

interface RadarrMovie {
  id: number;
  title: string;
  year: number;
  tmdbId: number;
  imdbId?: string;
  overview?: string;
  status: string;
  hasFile: boolean;
  monitored: boolean;
  sizeOnDisk: number;
  genres?: string[];
  ratings?: { imdb?: { value: number } };
  qualityProfileId?: number;
  rootFolderPath?: string;
}

interface RadarrQueueItem {
  id: number;
  title: string;
  status: string;
  trackedDownloadStatus: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  protocol: string;
  downloadClient?: string;
  downloadId?: string;
}


// ─── Schemas ──────────────────────────────────────────────────────────────────

export const RadarrSearchSchema = z.object({
  title: z.string().describe("Movie title to search for"),
});

export const RadarrAddMovieSchema = z.object({
  tmdb_id: z.number().optional().describe("TMDB ID (from radarr_search_movie)"),
  title: z.string().optional().describe("Movie title — used to auto-lookup if tmdb_id not provided"),
  quality_profile: z.string().optional().describe("Quality profile name (default: first available)"),
});

export const RadarrRemoveMovieSchema = z.object({
  tmdb_id: z.number().describe("TMDB ID of the movie to remove"),
  delete_files: z.boolean().optional().default(false).describe("Also delete downloaded files (default false)"),
});

export const RadarrForceSearchSchema = z.object({
  tmdb_id: z.number().describe("TMDB ID of the movie to search for"),
});

// ─── Implementations ──────────────────────────────────────────────────────────

export async function radarrSearchMovie(
  client: ArrClient,
  input: z.infer<typeof RadarrSearchSchema>
): Promise<string> {
  const results = await client.get<RadarrMovie[]>("/movie/lookup", { term: input.title });
  if (!results.length) return "No results found.";
  return results
    .slice(0, 8)
    .map((m) => {
      const rating = m.ratings?.imdb?.value ? ` | IMDb ${m.ratings.imdb.value}` : "";
      const genres = m.genres?.slice(0, 3).join(", ") ?? "";
      return `[tmdbId: ${m.tmdbId}] ${m.title} (${m.year})${rating}\n  ${genres}\n  ${(m.overview ?? "").slice(0, 120)}...`;
    })
    .join("\n\n");
}

export async function radarrAddMovie(
  client: ArrClient,
  input: z.infer<typeof RadarrAddMovieSchema>
): Promise<string> {
  let tmdbId = input.tmdb_id;

  if (!tmdbId) {
    if (!input.title) throw new Error("Provide either tmdb_id or title");
    const results = await client.get<RadarrMovie[]>("/movie/lookup", { term: input.title });
    if (!results.length) return `No results found for "${input.title}"`;
    tmdbId = results[0].tmdbId;
  }

  // Check if already in library
  const existing = await client.get<RadarrMovie[]>("/movie");
  const already = existing.find((m) => m.tmdbId === tmdbId);
  if (already) return `"${already.title}" is already in your Radarr library (${already.hasFile ? "downloaded" : "not yet downloaded"}).`;

  // Get quality profile
  const profiles = await client.get<QualityProfile[]>("/qualityprofile");
  let profileId: number;
  if (input.quality_profile) {
    const match = profiles.find(
      (p) => p.name.toLowerCase() === input.quality_profile!.toLowerCase()
    );
    if (!match) throw new Error(`Quality profile "${input.quality_profile}" not found. Available: ${profiles.map((p) => p.name).join(", ")}`);
    profileId = match.id;
  } else {
    profileId = await getFirstQualityProfileId(client, "Radarr");
  }

  const rootFolder = process.env.RADARR_ROOT_FOLDER;
  if (!rootFolder) throw new Error("RADARR_ROOT_FOLDER is not set in .env");

  // Lookup movie details
  const lookup = await client.get<RadarrMovie[]>("/movie/lookup", { term: `tmdb:${tmdbId}` });
  if (!lookup.length) throw new Error(`Movie with tmdbId ${tmdbId} not found`);
  const movie = lookup[0];

  await client.post<RadarrMovie>("/movie", {
    title: movie.title,
    tmdbId: movie.tmdbId,
    qualityProfileId: profileId,
    rootFolderPath: rootFolder,
    monitored: true,
    minimumAvailability: "announced",
    addOptions: { searchForMovie: true },
  });

  return `Added "${movie.title}" (${movie.year}) to Radarr — searching for a download now.`;
}

export async function radarrListMovies(client: ArrClient): Promise<string> {
  const movies = await client.get<RadarrMovie[]>("/movie");
  if (!movies.length) return "No movies in library yet.";
  const sorted = [...movies].sort((a, b) => a.title.localeCompare(b.title));
  return sorted
    .map((m) => {
      const status = m.hasFile ? `✓ ${bytes(m.sizeOnDisk)}` : m.monitored ? "⬇ missing" : "○ unmonitored";
      return `[${m.tmdbId}] ${m.title} (${m.year}) — ${status}`;
    })
    .join("\n");
}

export async function radarrRemoveMovie(
  client: ArrClient,
  input: z.infer<typeof RadarrRemoveMovieSchema>
): Promise<string> {
  const movies = await client.get<RadarrMovie[]>("/movie");
  const movie = movies.find((m) => m.tmdbId === input.tmdb_id);
  if (!movie) throw new Error(`No movie with tmdbId ${input.tmdb_id} in library`);
  await client.delete(`/movie/${movie.id}`, { deleteFiles: input.delete_files });
  return `Removed "${movie.title}" from Radarr${input.delete_files ? " (files deleted)" : ""}.`;
}

export async function radarrGetQueue(client: ArrClient): Promise<string> {
  const q = await client.get<{ records: RadarrQueueItem[] }>("/queue");
  if (!q.records.length) return "No active downloads in Radarr queue.";
  return q.records
    .map((item) => {
      const pct = item.size > 0 ? (((item.size - item.sizeleft) / item.size) * 100).toFixed(1) : "?";
      const eta = item.timeleft ?? "unknown";
      const hash = item.downloadId ? ` | hash:${item.downloadId}` : "";
      return `[queueId:${item.id}] ${item.title}\n  Status: ${item.status} | ${pct}% | ETA: ${eta} | ${item.protocol}${hash}`;
    })
    .join("\n\n");
}

export async function radarrForceSearch(
  client: ArrClient,
  input: z.infer<typeof RadarrForceSearchSchema>
): Promise<string> {
  const movies = await client.get<RadarrMovie[]>("/movie");
  const movie = movies.find((m) => m.tmdbId === input.tmdb_id);
  if (!movie) throw new Error(`No movie with tmdbId ${input.tmdb_id} in library`);

  await client.post("/command", { name: "MoviesSearch", movieIds: [movie.id] });
  return `Triggered search for "${movie.title}" — check radarr_get_queue in a moment to see what was grabbed.`;
}

export async function radarrGetHistory(client: ArrClient): Promise<string> {
  const h = await client.get<{ records: Array<{ movieId: number; eventType: string; date: string; data?: { fileId?: number }; quality?: { quality?: { name: string } }; sourceTitle?: string }> }>("/history", { pageSize: 20, sortKey: "date", sortDir: "desc" });
  if (!h.records.length) return "No history yet.";
  const movies = await client.get<RadarrMovie[]>("/movie");
  const movieMap = new Map(movies.map((m) => [m.id, m.title]));
  return h.records
    .map((r) => {
      const title = movieMap.get(r.movieId) ?? "Unknown";
      const date = new Date(r.date).toLocaleDateString();
      const quality = r.quality?.quality?.name ?? "";
      return `${date} | ${r.eventType} | ${title}${quality ? ` [${quality}]` : ""}`;
    })
    .join("\n");
}

// ─── Queue & blocklist management ────────────────────────────────────────────

export async function radarrClearQueue(client: ArrClient): Promise<string> {
  const q = await client.get<{ records: Array<{ id: number }> }>("/queue");
  if (!q.records.length) return "Radarr queue is already empty.";
  const ids = q.records.map((r) => r.id);
  await client.deleteWithBody("/queue/bulk", { ids }, { removeFromClient: true, blocklist: false });
  return `Cleared ${ids.length} item(s) from Radarr queue.`;
}

export async function radarrClearBlocklist(client: ArrClient): Promise<string> {
  const b = await client.get<{ records: Array<{ id: number }> }>("/blocklist");
  if (!b.records.length) return "Radarr blocklist is already empty.";
  const ids = b.records.map((r) => r.id);
  await client.deleteWithBody("/blocklist/bulk", { ids });
  return `Cleared ${ids.length} blocklist entry(s) from Radarr.`;
}

// ─── Path mappings ────────────────────────────────────────────────────────────

interface PathMapping { id?: number; host: string; remotePath: string; localPath: string; }

export const PathMappingSchema = z.object({
  host: z.string().describe("Download client host (e.g. qbittorrent)"),
  remote_path: z.string().describe("Path as seen by the download client (e.g. /downloads/)"),
  local_path: z.string().describe("Path as seen by Radarr (e.g. /data/downloads/)"),
});

export async function radarrListPathMappings(client: ArrClient): Promise<string> {
  const mappings = await client.get<PathMapping[]>("/remotepathmapping");
  if (!mappings.length) return "No remote path mappings configured.";
  return mappings.map((m) => `[${m.id}] ${m.host}: ${m.remotePath} → ${m.localPath}`).join("\n");
}

export async function radarrSetPathMapping(
  client: ArrClient,
  input: z.infer<typeof PathMappingSchema>
): Promise<string> {
  const existing = await client.get<PathMapping[]>("/remotepathmapping");
  const match = existing.find((m) => m.host === input.host);
  if (match) {
    await client.put(`/remotepathmapping/${match.id}`, { ...match, remotePath: input.remote_path, localPath: input.local_path });
    return `Updated path mapping: ${input.host}: ${input.remote_path} → ${input.local_path}`;
  }
  await client.post("/remotepathmapping", { host: input.host, remotePath: input.remote_path, localPath: input.local_path });
  return `Added path mapping: ${input.host}: ${input.remote_path} → ${input.local_path}`;
}

// ─── Blocklist & release checker ─────────────────────────────────────────────

export const RadarrBlocklistReleaseSchema = z.object({
  queue_id: z.number().describe("Queue item ID from radarr_get_queue (shown as queueId:X)"),
  retry: z.boolean().optional().default(true).describe("Trigger a new search after blocklisting (default true)"),
});

export const RadarrCheckReleasesSchema = z.object({
  tmdb_id: z.number().describe("TMDB ID of the movie to check releases for"),
});

export async function radarrBlocklistRelease(
  client: ArrClient,
  input: z.infer<typeof RadarrBlocklistReleaseSchema>
): Promise<string> {
  const q = await client.get<{ records: RadarrQueueItem[] }>("/queue");
  const item = q.records.find((r) => r.id === input.queue_id);
  if (!item) throw new Error(`No queue item with id ${input.queue_id}`);

  await client.delete(`/queue/${input.queue_id}`, {
    blocklist: true,
    removeFromClient: true,
  });

  if (!input.retry) return `Blocklisted and removed "${item.title}" from queue.`;

  // Trigger a new search — need the movieId from history or queue title match
  const movies = await client.get<RadarrMovie[]>("/movie");
  const movie = movies.find((m) => item.title.includes(m.title));
  if (movie) {
    await client.post("/command", { name: "MoviesSearch", movieIds: [movie.id] });
    return `Blocklisted "${item.title}", removed from queue, and triggered a new search.`;
  }

  return `Blocklisted and removed "${item.title}" from queue (could not match to a movie for retry).`;
}

export async function radarrCheckReleases(
  client: ArrClient,
  input: z.infer<typeof RadarrCheckReleasesSchema>
): Promise<string> {
  const movies = await client.get<RadarrMovie[]>("/movie");
  const movie = movies.find((m) => m.tmdbId === input.tmdb_id);
  if (!movie) throw new Error(`No movie with tmdbId ${input.tmdb_id} in library`);

  const releases = await client.get<Array<{ title: string; rejections: string[]; indexer?: string; size?: number; quality?: { quality?: { name: string } } }>>(`/release?movieId=${movie.id}`);

  const grabbable = releases.filter((r) => !r.rejections?.length);
  const rejected = releases.filter((r) => r.rejections?.length && !r.rejections.some((x) => x.includes("Unknown")));

  const lines: string[] = [`Releases for "${movie.title}" (${releases.length} total):\n`];

  if (grabbable.length) {
    lines.push("GRABBABLE:");
    grabbable.slice(0, 5).forEach((r) => {
      const size = r.size ? ` ${bytes(r.size)}` : "";
      const q = r.quality?.quality?.name ?? "";
      lines.push(`  ✓ ${r.title}${size}${q ? ` [${q}]` : ""}`);
    });
  } else {
    lines.push("GRABBABLE: none");
  }

  lines.push("\nREJECTED:");
  rejected.slice(0, 8).forEach((r) => {
    lines.push(`  ✗ ${r.title}`);
    r.rejections.forEach((rej) => lines.push(`      → ${rej}`));
  });

  return lines.join("\n");
}
