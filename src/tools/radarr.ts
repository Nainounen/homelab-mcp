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

export const RadarrListMoviesSchema = z.object({
  filter: z
    .enum(["all", "missing", "downloaded", "unmonitored"])
    .optional()
    .default("all")
    .describe("Filter: 'missing' = monitored but no file, 'downloaded' = has file, 'unmonitored' (default: all)"),
  search: z.string().optional().describe("Only show titles containing this text (case-insensitive)"),
  limit: z.number().int().positive().optional().default(100).describe("Max titles to return (default 100)"),
});

// ─── Implementations ──────────────────────────────────────────────────────────

/** Look up a library movie by TMDB ID using Radarr's server-side filter (avoids fetching the whole library). */
async function getMovieByTmdbId(client: ArrClient, tmdbId: number): Promise<RadarrMovie | undefined> {
  const matches = await client.get<RadarrMovie[]>("/movie", { tmdbId });
  return matches[0];
}

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
  const already = await getMovieByTmdbId(client, tmdbId);
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

export async function radarrListMovies(
  client: ArrClient,
  input: z.infer<typeof RadarrListMoviesSchema>
): Promise<string> {
  const movies = await client.get<RadarrMovie[]>("/movie");
  if (!movies.length) return "No movies in library yet.";

  let filtered = movies;
  if (input.filter === "missing") filtered = movies.filter((m) => m.monitored && !m.hasFile);
  else if (input.filter === "downloaded") filtered = movies.filter((m) => m.hasFile);
  else if (input.filter === "unmonitored") filtered = movies.filter((m) => !m.monitored);
  if (input.search) {
    const needle = input.search.toLowerCase();
    filtered = filtered.filter((m) => m.title.toLowerCase().includes(needle));
  }
  if (!filtered.length) return `No movies match (library has ${movies.length} total).`;

  const sorted = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  const shown = sorted.slice(0, input.limit);
  const lines = shown.map((m) => {
    const status = m.hasFile ? `✓ ${bytes(m.sizeOnDisk)}` : m.monitored ? "⬇ missing" : "○ unmonitored";
    return `[${m.tmdbId}] ${m.title} (${m.year}) — ${status}`;
  });

  const header =
    shown.length < sorted.length
      ? `Showing ${shown.length} of ${sorted.length} matching movies (${movies.length} in library) — use filter/search/limit to narrow.\n`
      : `${sorted.length} movie(s) (${movies.length} in library):\n`;
  return header + lines.join("\n");
}

export async function radarrRemoveMovie(
  client: ArrClient,
  input: z.infer<typeof RadarrRemoveMovieSchema>
): Promise<string> {
  const movie = await getMovieByTmdbId(client, input.tmdb_id);
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
  const movie = await getMovieByTmdbId(client, input.tmdb_id);
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

// ─── Custom formats ───────────────────────────────────────────────────────────

interface CustomFormat {
  id: number;
  name: string;
  includeCustomFormatWhenRenaming: boolean;
  specifications: unknown[];
}

interface QualityProfileFull extends QualityProfile {
  formatItems?: Array<{ format: number; name: string; score: number }>;
}

export const CustomFormatSetSchema = z.object({
  name: z.string().describe("Custom format name (creates or updates by name)"),
  specifications: z
    .string()
    .optional()
    .describe(
      'JSON array of specification objects. Each spec needs at minimum: { "name": "...", "implementationName": "...", "implementation": "...", "negate": false, "required": false, "fields": [...] }. Omit to create a format with no conditions (score-only).'
    ),
  include_when_renaming: z.boolean().optional().default(false).describe("Include format tag in renamed files (default false)"),
});

export const CustomFormatDeleteSchema = z.object({
  name: z.string().describe("Name of the custom format to delete"),
});

export const CustomFormatScoreSchema = z.object({
  format_name: z.string().describe("Custom format name"),
  profile_name: z.string().optional().describe("Quality profile name (default: first available)"),
  score: z.number().int().describe("Score to assign (positive = prefer, negative = reject, 0 = ignore)"),
});

export async function radarrListCustomFormats(client: ArrClient): Promise<string> {
  const [formats, profiles] = await Promise.all([
    client.get<CustomFormat[]>("/customformat"),
    client.get<QualityProfileFull[]>("/qualityprofile"),
  ]);

  if (!formats.length) return "No custom formats configured in Radarr.";

  const scoreMap = new Map<number, Map<string, number>>();
  for (const p of profiles) {
    for (const fi of p.formatItems ?? []) {
      if (!scoreMap.has(fi.format)) scoreMap.set(fi.format, new Map());
      scoreMap.get(fi.format)!.set(p.name, fi.score);
    }
  }

  return formats
    .map((f) => {
      const scores = scoreMap.get(f.id);
      const scoreStr = scores && scores.size
        ? Array.from(scores.entries())
            .filter(([, s]) => s !== 0)
            .map(([p, s]) => `${p}: ${s > 0 ? "+" : ""}${s}`)
            .join(", ")
        : "no score";
      const specs = f.specifications.length;
      return `[${f.id}] ${f.name} | ${specs} condition(s) | ${scoreStr}`;
    })
    .join("\n");
}

export async function radarrSetCustomFormat(
  client: ArrClient,
  input: z.infer<typeof CustomFormatSetSchema>
): Promise<string> {
  const specs = input.specifications ? JSON.parse(input.specifications) : [];
  const existing = await client.get<CustomFormat[]>("/customformat");
  const match = existing.find((f) => f.name.toLowerCase() === input.name.toLowerCase());

  const payload = {
    name: input.name,
    includeCustomFormatWhenRenaming: input.include_when_renaming ?? false,
    specifications: specs,
  };

  if (match) {
    await client.put<CustomFormat>(`/customformat/${match.id}`, { ...payload, id: match.id });
    return `Updated custom format "${input.name}" (id: ${match.id}).`;
  }

  const created = await client.post<CustomFormat>("/customformat", payload);
  return `Created custom format "${input.name}" (id: ${created.id}).`;
}

export async function radarrDeleteCustomFormat(
  client: ArrClient,
  input: z.infer<typeof CustomFormatDeleteSchema>
): Promise<string> {
  const existing = await client.get<CustomFormat[]>("/customformat");
  const match = existing.find((f) => f.name.toLowerCase() === input.name.toLowerCase());
  if (!match) throw new Error(`Custom format "${input.name}" not found`);
  await client.delete(`/customformat/${match.id}`);
  return `Deleted custom format "${input.name}".`;
}

export async function radarrSetCfScore(
  client: ArrClient,
  input: z.infer<typeof CustomFormatScoreSchema>
): Promise<string> {
  const [formats, profiles] = await Promise.all([
    client.get<CustomFormat[]>("/customformat"),
    client.get<QualityProfileFull[]>("/qualityprofile"),
  ]);

  const format = formats.find((f) => f.name.toLowerCase() === input.format_name.toLowerCase());
  if (!format) throw new Error(`Custom format "${input.format_name}" not found`);

  let profile: QualityProfileFull;
  if (input.profile_name) {
    const p = profiles.find((p) => p.name.toLowerCase() === input.profile_name!.toLowerCase());
    if (!p) throw new Error(`Quality profile "${input.profile_name}" not found. Available: ${profiles.map((p) => p.name).join(", ")}`);
    profile = p;
  } else {
    profile = profiles[0];
    if (!profile) throw new Error("No quality profiles found in Radarr");
  }

  const formatItems = (profile.formatItems ?? []).map((fi) =>
    fi.format === format.id ? { ...fi, score: input.score } : fi
  );

  if (!formatItems.find((fi) => fi.format === format.id)) {
    formatItems.push({ format: format.id, name: format.name, score: input.score });
  }

  await client.put(`/qualityprofile/${profile.id}`, { ...profile, formatItems });
  return `Set score ${input.score > 0 ? "+" : ""}${input.score} for "${format.name}" in profile "${profile.name}".`;
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
  const movie = await getMovieByTmdbId(client, input.tmdb_id);
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

// ─── Interactive search & grab ────────────────────────────────────────────────

interface Release {
  guid: string;
  indexerId: number;
  indexer?: string;
  title: string;
  size: number;
  age: number;
  seeders?: number;
  rejections: string[];
  quality?: { quality?: { name: string } };
  customFormatScore?: number;
  customFormats?: Array<{ name: string }>;
  downloadAllowed?: boolean;
}

export const RadarrInteractiveSearchSchema = z.object({
  tmdb_id: z.number().describe("TMDB ID of the movie"),
  include_rejected: z.boolean().optional().default(false).describe("Also show rejected releases (default: false — only grabbable)"),
});

export const RadarrGrabReleaseSchema = z.object({
  tmdb_id: z.number().describe("TMDB ID of the movie (same as used in radarr_interactive_search)"),
  guid: z.string().describe("Release GUID from radarr_interactive_search output"),
});

export async function radarrInteractiveSearch(
  client: ArrClient,
  input: z.infer<typeof RadarrInteractiveSearchSchema>
): Promise<string> {
  const movie = await getMovieByTmdbId(client, input.tmdb_id);
  if (!movie) throw new Error(`No movie with tmdbId ${input.tmdb_id} in library`);

  const releases = await client.get<Release[]>(`/release?movieId=${movie.id}`);
  if (!releases.length) return `No releases found for "${movie.title}".`;

  const grabbable = releases.filter((r) => !r.rejections?.length);
  const rejected = releases.filter((r) => r.rejections?.length);
  const shown = input.include_rejected ? releases : grabbable;

  if (!shown.length) {
    return `No grabbable releases for "${movie.title}" (${rejected.length} rejected). Pass include_rejected: true to see why.`;
  }

  const lines: string[] = [`Interactive search for "${movie.title}" — ${grabbable.length} grabbable, ${rejected.length} rejected:\n`];
  lines.push("Pass the guid to radarr_grab_release to download a specific release.\n");

  shown.forEach((r, i) => {
    const q = r.quality?.quality?.name ?? "?";
    const size = bytes(r.size);
    const age = `${r.age}d`;
    const score = r.customFormatScore !== undefined ? ` | CF score: ${r.customFormatScore > 0 ? "+" : ""}${r.customFormatScore}` : "";
    const status = r.rejections?.length ? ` ✗ REJECTED: ${r.rejections[0]}` : " ✓";
    lines.push(`[${i + 1}] guid:${r.guid}`);
    lines.push(`     ${r.title}`);
    lines.push(`     ${q} | ${size} | ${age} old | ${r.indexer ?? r.indexerId}${score}${status}`);
  });

  return lines.join("\n");
}

export async function radarrGrabRelease(
  client: ArrClient,
  input: z.infer<typeof RadarrGrabReleaseSchema>
): Promise<string> {
  const movie = await getMovieByTmdbId(client, input.tmdb_id);
  if (!movie) throw new Error(`No movie with tmdbId ${input.tmdb_id} in library`);

  const releases = await client.get<Release[]>(`/release?movieId=${movie.id}`);
  const release = releases.find((r) => r.guid === input.guid);
  if (!release) throw new Error(`Release with guid "${input.guid}" not found. Re-run radarr_interactive_search to get fresh GUIDs.`);

  await client.post("/release", release);
  const q = release.quality?.quality?.name ?? "?";
  return `Grabbing "${release.title}" [${q}] — check radarr_get_queue to monitor progress.`;
}

// ─── Manual import ────────────────────────────────────────────────────────────

interface ManualImportItem {
  path: string;
  name: string;
  size: number;
  quality?: { quality?: { name: string } };
  movie?: { id: number; title: string };
  rejections?: Array<{ reason: string }>;
  releaseGroup?: string;
  languages?: Array<{ id: number; name: string }>;
}

export const RadarrManualImportSchema = z.object({
  folder: z.string().describe("Absolute path of the folder to scan for importable files"),
  preview_only: z.boolean().optional().default(false).describe("When true, show matches without importing (default false — applies the import)"),
  filter_existing: z.boolean().optional().default(true).describe("Skip files already in the library (default true)"),
});

export async function radarrManualImport(
  client: ArrClient,
  input: z.infer<typeof RadarrManualImportSchema>
): Promise<string> {
  const items = await client.get<ManualImportItem[]>("/manualimport", {
    folder: input.folder,
    filterExistingFiles: input.filter_existing,
  });

  if (!items.length) return `No importable files found in "${input.folder}".`;

  const matched = items.filter((i) => i.movie?.id && !i.rejections?.length);
  const unmatched = items.filter((i) => !i.movie?.id || i.rejections?.length);

  const lines: string[] = [`Manual import scan of "${input.folder}" — ${items.length} file(s):\n`];

  if (matched.length) {
    lines.push(`READY TO IMPORT (${matched.length}):`);
    matched.forEach((i) => {
      const q = i.quality?.quality?.name ?? "?";
      lines.push(`  ✓ ${i.movie!.title} | ${q} | ${bytes(i.size)}`);
      lines.push(`      ${i.path}`);
    });
  }

  if (unmatched.length) {
    lines.push(`\nNEEDS ATTENTION (${unmatched.length}):`);
    unmatched.forEach((i) => {
      const reason = i.rejections?.map((r) => r.reason).join("; ") ?? "no movie match";
      lines.push(`  ✗ ${i.name} — ${reason}`);
      lines.push(`      ${i.path}`);
    });
  }

  if (input.preview_only) {
    lines.push("\n(Preview only — pass preview_only: false to apply the import.)");
    return lines.join("\n");
  }

  if (!matched.length) return lines.join("\n") + "\n\nNothing to import — all files need manual attention.";

  const payload = matched.map((i) => ({
    path: i.path,
    movieId: i.movie!.id,
    quality: i.quality,
    languages: i.languages ?? [],
    releaseGroup: i.releaseGroup ?? "",
    downloadId: undefined,
  }));

  await client.post("/manualimport", payload);
  lines.push(`\nImported ${matched.length} file(s) successfully.`);
  return lines.join("\n");
}
