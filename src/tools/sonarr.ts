import { z } from "zod";
import { ArrClient } from "../arr.js";
import { bytes, getFirstQualityProfileId, QualityProfile } from "../utils.js";

interface SonarrSeries {
  id: number;
  title: string;
  year: number;
  tvdbId: number;
  imdbId?: string;
  overview?: string;
  status: string;
  monitored: boolean;
  statistics?: {
    episodeCount: number;
    episodeFileCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
  genres?: string[];
  network?: string;
  qualityProfileId?: number;
}

interface SonarrQueueItem {
  id: number;
  title: string;
  status: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  protocol: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const SonarrSearchSchema = z.object({
  title: z.string().describe("Series title to search for"),
});

export const SonarrAddSeriesSchema = z.object({
  tvdb_id: z.number().optional().describe("TVDB ID (from sonarr_search_series)"),
  title: z.string().optional().describe("Series title — used to auto-lookup if tvdb_id not provided"),
  quality_profile: z.string().optional().describe("Quality profile name (default: first available)"),
  monitor: z.enum(["all", "future", "missing", "existing", "none"]).optional().default("all").describe("Which episodes to monitor (default: all)"),
});

export const SonarrRemoveSeriesSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series to remove"),
  delete_files: z.boolean().optional().default(false).describe("Also delete downloaded files (default false)"),
});

export const SonarrForceSearchSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series to search for"),
});

export const SonarrListSeriesSchema = z.object({
  filter: z
    .enum(["all", "missing", "complete", "unmonitored"])
    .optional()
    .default("all")
    .describe("Filter: 'missing' = has missing episodes, 'complete' = all episodes downloaded, 'unmonitored' (default: all)"),
  search: z.string().optional().describe("Only show titles containing this text (case-insensitive)"),
  limit: z.number().int().positive().optional().default(100).describe("Max titles to return (default 100)"),
});

// ─── Implementations ──────────────────────────────────────────────────────────

/** Look up a library series by TVDB ID using Sonarr's server-side filter (avoids fetching the whole library). */
async function getSeriesByTvdbId(client: ArrClient, tvdbId: number): Promise<SonarrSeries | undefined> {
  const matches = await client.get<SonarrSeries[]>("/series", { tvdbId });
  return matches[0];
}

export async function sonarrSearchSeries(
  client: ArrClient,
  input: z.infer<typeof SonarrSearchSchema>
): Promise<string> {
  const results = await client.get<SonarrSeries[]>("/series/lookup", { term: input.title });
  if (!results.length) return "No results found.";
  return results
    .slice(0, 8)
    .map((s) => {
      const network = s.network ? ` | ${s.network}` : "";
      const genres = s.genres?.slice(0, 3).join(", ") ?? "";
      return `[tvdbId: ${s.tvdbId}] ${s.title} (${s.year})${network}\n  ${genres}\n  ${(s.overview ?? "").slice(0, 120)}...`;
    })
    .join("\n\n");
}

export async function sonarrAddSeries(
  client: ArrClient,
  input: z.infer<typeof SonarrAddSeriesSchema>
): Promise<string> {
  let tvdbId = input.tvdb_id;

  if (!tvdbId) {
    if (!input.title) throw new Error("Provide either tvdb_id or title");
    const results = await client.get<SonarrSeries[]>("/series/lookup", { term: input.title });
    if (!results.length) return `No results found for "${input.title}"`;
    tvdbId = results[0].tvdbId;
  }

  const already = await getSeriesByTvdbId(client, tvdbId);
  if (already) {
    const pct = already.statistics?.percentOfEpisodes?.toFixed(0) ?? "?";
    return `"${already.title}" is already in your Sonarr library (${pct}% episodes downloaded).`;
  }

  const profiles = await client.get<QualityProfile[]>("/qualityprofile");
  let profileId: number;
  if (input.quality_profile) {
    const match = profiles.find(
      (p) => p.name.toLowerCase() === input.quality_profile!.toLowerCase()
    );
    if (!match) throw new Error(`Quality profile "${input.quality_profile}" not found. Available: ${profiles.map((p) => p.name).join(", ")}`);
    profileId = match.id;
  } else {
    profileId = await getFirstQualityProfileId(client, "Sonarr");
  }

  const rootFolder = process.env.SONARR_ROOT_FOLDER;
  if (!rootFolder) throw new Error("SONARR_ROOT_FOLDER is not set in .env");

  const lookup = await client.get<SonarrSeries[]>("/series/lookup", { term: `tvdb:${tvdbId}` });
  if (!lookup.length) throw new Error(`Series with tvdbId ${tvdbId} not found`);
  const series = lookup[0];

  await client.post<SonarrSeries>("/series", {
    title: series.title,
    tvdbId: series.tvdbId,
    qualityProfileId: profileId,
    rootFolderPath: rootFolder,
    monitored: true,
    seasonFolder: true,
    addOptions: {
      searchForMissingEpisodes: true,
      monitor: input.monitor,
    },
  });

  return `Added "${series.title}" (${series.year}) to Sonarr — searching for episodes now.`;
}

export async function sonarrListSeries(
  client: ArrClient,
  input: z.infer<typeof SonarrListSeriesSchema>
): Promise<string> {
  const series = await client.get<SonarrSeries[]>("/series");
  if (!series.length) return "No series in library yet.";

  let filtered = series;
  if (input.filter === "missing") {
    filtered = series.filter((s) => s.monitored && (s.statistics?.episodeFileCount ?? 0) < (s.statistics?.episodeCount ?? 0));
  } else if (input.filter === "complete") {
    filtered = series.filter((s) => (s.statistics?.episodeCount ?? 0) > 0 && s.statistics?.episodeFileCount === s.statistics?.episodeCount);
  } else if (input.filter === "unmonitored") {
    filtered = series.filter((s) => !s.monitored);
  }
  if (input.search) {
    const needle = input.search.toLowerCase();
    filtered = filtered.filter((s) => s.title.toLowerCase().includes(needle));
  }
  if (!filtered.length) return `No series match (library has ${series.length} total).`;

  const sorted = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  const shown = sorted.slice(0, input.limit);
  const lines = shown.map((s) => {
    const eps = s.statistics
      ? `${s.statistics.episodeFileCount}/${s.statistics.episodeCount} eps | ${bytes(s.statistics.sizeOnDisk)}`
      : s.status;
    return `[${s.tvdbId}] ${s.title} (${s.year}) — ${eps}`;
  });

  const header =
    shown.length < sorted.length
      ? `Showing ${shown.length} of ${sorted.length} matching series (${series.length} in library) — use filter/search/limit to narrow.\n`
      : `${sorted.length} series (${series.length} in library):\n`;
  return header + lines.join("\n");
}

export async function sonarrRemoveSeries(
  client: ArrClient,
  input: z.infer<typeof SonarrRemoveSeriesSchema>
): Promise<string> {
  const s = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!s) throw new Error(`No series with tvdbId ${input.tvdb_id} in library`);
  await client.delete(`/series/${s.id}`, { deleteFiles: input.delete_files });
  return `Removed "${s.title}" from Sonarr${input.delete_files ? " (files deleted)" : ""}.`;
}

export async function sonarrGetQueue(client: ArrClient): Promise<string> {
  const q = await client.get<{ records: SonarrQueueItem[] }>("/queue");
  if (!q.records.length) return "No active downloads in Sonarr queue.";
  return q.records
    .map((item) => {
      const pct = item.size > 0 ? (((item.size - item.sizeleft) / item.size) * 100).toFixed(1) : "?";
      const eta = item.timeleft ?? "unknown";
      return `${item.title}\n  Status: ${item.status} | ${pct}% | ETA: ${eta} | ${item.protocol}`;
    })
    .join("\n\n");
}

export async function sonarrForceSearch(
  client: ArrClient,
  input: z.infer<typeof SonarrForceSearchSchema>
): Promise<string> {
  const s = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!s) throw new Error(`No series with tvdbId ${input.tvdb_id} in library`);
  await client.post("/command", { name: "SeriesSearch", seriesId: s.id });
  return `Triggered search for all missing episodes of "${s.title}".`;
}

// ─── Queue & blocklist & season search ───────────────────────────────────────

export async function sonarrClearQueue(client: ArrClient): Promise<string> {
  const q = await client.get<{ records: Array<{ id: number }> }>("/queue");
  if (!q.records.length) return "Sonarr queue is already empty.";
  const ids = [...new Set(q.records.map((r) => r.id))];
  await client.deleteWithBody("/queue/bulk", { ids }, { removeFromClient: true, blocklist: false });
  return `Cleared ${ids.length} item(s) from Sonarr queue.`;
}

export async function sonarrClearBlocklist(client: ArrClient): Promise<string> {
  const b = await client.get<{ records: Array<{ id: number }> }>("/blocklist");
  if (!b.records.length) return "Sonarr blocklist is already empty.";
  const ids = b.records.map((r) => r.id);
  await client.deleteWithBody("/blocklist/bulk", { ids });
  return `Cleared ${ids.length} blocklist entry(s) from Sonarr.`;
}

export const SonarrSeasonSearchSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series"),
  season: z.number().describe("Season number to search"),
});

export async function sonarrSeasonSearch(
  client: ArrClient,
  input: z.infer<typeof SonarrSeasonSearchSchema>
): Promise<string> {
  const s = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!s) throw new Error(`No series with tvdbId ${input.tvdb_id} in library`);
  await client.post("/command", { name: "SeasonSearch", seriesId: s.id, seasonNumber: input.season });
  return `Triggered search for "${s.title}" Season ${input.season}.`;
}

// ─── Path mappings ────────────────────────────────────────────────────────────

interface PathMapping { id?: number; host: string; remotePath: string; localPath: string; }

export const SonarrPathMappingSchema = z.object({
  host: z.string().describe("Download client host (e.g. qbittorrent)"),
  remote_path: z.string().describe("Path as seen by the download client (e.g. /downloads/)"),
  local_path: z.string().describe("Path as seen by Sonarr (e.g. /data/downloads/)"),
});

export async function sonarrListPathMappings(client: ArrClient): Promise<string> {
  const mappings = await client.get<PathMapping[]>("/remotepathmapping");
  if (!mappings.length) return "No remote path mappings configured.";
  return mappings.map((m) => `[${m.id}] ${m.host}: ${m.remotePath} → ${m.localPath}`).join("\n");
}

export async function sonarrSetPathMapping(
  client: ArrClient,
  input: z.infer<typeof SonarrPathMappingSchema>
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

// ─── Blocklist release ────────────────────────────────────────────────────────

export const SonarrBlocklistReleaseSchema = z.object({
  queue_id: z.number().describe("Queue item ID from sonarr_get_queue"),
  retry: z.boolean().optional().default(true).describe("Trigger a new search after blocklisting (default true)"),
});

export async function sonarrBlocklistRelease(
  client: ArrClient,
  input: z.infer<typeof SonarrBlocklistReleaseSchema>
): Promise<string> {
  const q = await client.get<{ records: SonarrQueueItem[] }>("/queue");
  const item = q.records.find((r) => r.id === input.queue_id);
  if (!item) throw new Error(`No queue item with id ${input.queue_id}`);

  await client.delete(`/queue/${input.queue_id}`, { blocklist: true, removeFromClient: true });

  if (!input.retry) return `Blocklisted and removed "${item.title}" from queue.`;

  const series = await client.get<SonarrSeries[]>("/series");
  const s = series.find((x) => item.title.toLowerCase().includes(x.title.toLowerCase()));
  if (s) {
    await client.post("/command", { name: "SeriesSearch", seriesId: s.id });
    return `Blocklisted "${item.title}", removed from queue, and triggered a new search.`;
  }
  return `Blocklisted and removed "${item.title}" from queue (could not match to a series for retry).`;
}

// ─── Release checker ──────────────────────────────────────────────────────────

export const SonarrCheckReleasesSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series"),
  season: z.number().optional().describe("Season number to check (checks season 1 if omitted)"),
});

export async function sonarrCheckReleases(
  client: ArrClient,
  input: z.infer<typeof SonarrCheckReleasesSchema>
): Promise<string> {
  const s = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!s) throw new Error(`No series with tvdbId ${input.tvdb_id} in library`);

  const seasonNum = input.season ?? 1;
  const episodes = await client.get<Array<{ id: number; seasonNumber: number; episodeNumber: number }>>(`/episode?seriesId=${s.id}&seasonNumber=${seasonNum}`);
  if (!episodes.length) return `No episodes found for S${String(seasonNum).padStart(2, "0")}.`;

  const ep = episodes[0];
  const releases = await client.get<Array<{ title: string; rejections: string[]; size?: number; quality?: { quality?: { name: string } } }>>(`/release?episodeId=${ep.id}`);

  const relevant = releases.filter((r) => !r.rejections?.some((x) => x.includes("Unknown Series")));
  const grabbable = relevant.filter((r) => !r.rejections?.length);
  const rejected = relevant.filter((r) => r.rejections?.length);

  const lines: string[] = [`Releases for "${s.title}" S${String(seasonNum).padStart(2, "0")} (${relevant.length} relevant):\n`];

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

  if (rejected.length) {
    lines.push("\nREJECTED:");
    rejected.slice(0, 6).forEach((r) => {
      lines.push(`  ✗ ${r.title}`);
      r.rejections.forEach((rej) => lines.push(`      → ${rej}`));
    });
  }

  return lines.join("\n");
}
