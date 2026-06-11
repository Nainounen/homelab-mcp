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

export async function sonarrListCustomFormats(client: ArrClient): Promise<string> {
  const [formats, profiles] = await Promise.all([
    client.get<CustomFormat[]>("/customformat"),
    client.get<QualityProfileFull[]>("/qualityprofile"),
  ]);

  if (!formats.length) return "No custom formats configured in Sonarr.";

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

export async function sonarrSetCustomFormat(
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

export async function sonarrDeleteCustomFormat(
  client: ArrClient,
  input: z.infer<typeof CustomFormatDeleteSchema>
): Promise<string> {
  const existing = await client.get<CustomFormat[]>("/customformat");
  const match = existing.find((f) => f.name.toLowerCase() === input.name.toLowerCase());
  if (!match) throw new Error(`Custom format "${input.name}" not found`);
  await client.delete(`/customformat/${match.id}`);
  return `Deleted custom format "${input.name}".`;
}

export async function sonarrSetCfScore(
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
    if (!profile) throw new Error("No quality profiles found in Sonarr");
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
  downloadAllowed?: boolean;
  fullSeason?: boolean;
}

export const SonarrInteractiveSearchSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series"),
  season: z.number().describe("Season number to search"),
  episode: z.number().optional().describe("Episode number — omit to show season-pack and first-episode releases"),
  include_rejected: z.boolean().optional().default(false).describe("Also show rejected releases (default: false)"),
});

export const SonarrGrabReleaseSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series (same as used in sonarr_interactive_search)"),
  guid: z.string().describe("Release GUID from sonarr_interactive_search output"),
  season: z.number().describe("Season number — must match what was used in sonarr_interactive_search"),
  episode: z.number().optional().describe("Episode number — must match if sonarr_interactive_search was called with one"),
});

export async function sonarrInteractiveSearch(
  client: ArrClient,
  input: z.infer<typeof SonarrInteractiveSearchSchema>
): Promise<string> {
  const s = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!s) throw new Error(`No series with tvdbId ${input.tvdb_id} in library`);

  const episodes = await client.get<Array<{ id: number; seasonNumber: number; episodeNumber: number }>>(
    `/episode?seriesId=${s.id}&seasonNumber=${input.season}`
  );
  if (!episodes.length) return `No episodes found for S${String(input.season).padStart(2, "0")}.`;

  const ep = input.episode
    ? episodes.find((e) => e.episodeNumber === input.episode)
    : episodes[0];
  if (!ep) throw new Error(`Episode ${input.episode} not found in S${String(input.season).padStart(2, "0")}`);

  const releases = await client.get<Release[]>(`/release?episodeId=${ep.id}`);
  const relevant = releases.filter((r) => !r.rejections?.some((x) => x.includes("Unknown Series")));

  const grabbable = relevant.filter((r) => !r.rejections?.length);
  const rejected = relevant.filter((r) => r.rejections?.length);
  const shown = input.include_rejected ? relevant : grabbable;

  if (!shown.length) {
    return `No grabbable releases for "${s.title}" S${String(input.season).padStart(2, "0")} (${rejected.length} rejected). Pass include_rejected: true to see why.`;
  }

  const epLabel = input.episode
    ? `S${String(input.season).padStart(2, "0")}E${String(input.episode).padStart(2, "0")}`
    : `S${String(input.season).padStart(2, "0")}`;

  const lines: string[] = [
    `Interactive search for "${s.title}" ${epLabel} — ${grabbable.length} grabbable, ${rejected.length} rejected:\n`,
    "Pass the guid to sonarr_grab_release to download a specific release.\n",
  ];

  shown.forEach((r, i) => {
    const q = r.quality?.quality?.name ?? "?";
    const size = bytes(r.size);
    const age = `${r.age}d`;
    const score = r.customFormatScore !== undefined ? ` | CF score: ${r.customFormatScore > 0 ? "+" : ""}${r.customFormatScore}` : "";
    const pack = r.fullSeason ? " [SEASON PACK]" : "";
    const status = r.rejections?.length ? ` ✗ REJECTED: ${r.rejections[0]}` : " ✓";
    lines.push(`[${i + 1}] guid:${r.guid}`);
    lines.push(`     ${r.title}${pack}`);
    lines.push(`     ${q} | ${size} | ${age} old | ${r.indexer ?? r.indexerId}${score}${status}`);
  });

  return lines.join("\n");
}

export async function sonarrGrabRelease(
  client: ArrClient,
  input: z.infer<typeof SonarrGrabReleaseSchema>
): Promise<string> {
  const s = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!s) throw new Error(`No series with tvdbId ${input.tvdb_id} in library`);

  const episodes = await client.get<Array<{ id: number; seasonNumber: number; episodeNumber: number }>>(
    `/episode?seriesId=${s.id}&seasonNumber=${input.season}`
  );
  const ep = input.episode
    ? episodes.find((e) => e.episodeNumber === input.episode)
    : episodes[0];
  if (!ep) throw new Error(`Episode not found in S${String(input.season).padStart(2, "0")}`);

  const releases = await client.get<Release[]>(`/release?episodeId=${ep.id}`);
  const release = releases.find((r) => r.guid === input.guid);
  if (!release) throw new Error(`Release with guid "${input.guid}" not found. Re-run sonarr_interactive_search to get fresh GUIDs.`);

  await client.post("/release", release);
  const q = release.quality?.quality?.name ?? "?";
  return `Grabbing "${release.title}" [${q}] — check sonarr_get_queue to monitor progress.`;
}

// ─── Manual import ────────────────────────────────────────────────────────────

interface SonarrManualImportItem {
  path: string;
  name: string;
  size: number;
  quality?: { quality?: { name: string } };
  series?: { id: number; title: string };
  seasonNumber?: number;
  episodes?: Array<{ id: number; episodeNumber: number; title: string }>;
  rejections?: Array<{ reason: string }>;
  releaseGroup?: string;
  languages?: Array<{ id: number; name: string }>;
}

export const SonarrManualImportSchema = z.object({
  folder: z.string().describe("Absolute path of the folder to scan for importable files"),
  preview_only: z.boolean().optional().default(false).describe("When true, show matches without importing (default false — applies the import)"),
  filter_existing: z.boolean().optional().default(true).describe("Skip files already in the library (default true)"),
});

export async function sonarrManualImport(
  client: ArrClient,
  input: z.infer<typeof SonarrManualImportSchema>
): Promise<string> {
  const items = await client.get<SonarrManualImportItem[]>("/manualimport", {
    folder: input.folder,
    filterExistingFiles: input.filter_existing,
  });

  if (!items.length) return `No importable files found in "${input.folder}".`;

  const matched = items.filter((i) => i.series?.id && i.episodes?.length && !i.rejections?.length);
  const unmatched = items.filter((i) => !i.series?.id || !i.episodes?.length || i.rejections?.length);

  const lines: string[] = [`Manual import scan of "${input.folder}" — ${items.length} file(s):\n`];

  if (matched.length) {
    lines.push(`READY TO IMPORT (${matched.length}):`);
    matched.forEach((i) => {
      const q = i.quality?.quality?.name ?? "?";
      const epLabel = i.episodes?.map((e) => `E${String(e.episodeNumber).padStart(2, "0")}`).join("+") ?? "?";
      lines.push(`  ✓ ${i.series!.title} S${String(i.seasonNumber ?? 0).padStart(2, "0")}${epLabel} | ${q} | ${bytes(i.size)}`);
      lines.push(`      ${i.path}`);
    });
  }

  if (unmatched.length) {
    lines.push(`\nNEEDS ATTENTION (${unmatched.length}):`);
    unmatched.forEach((i) => {
      const reason = i.rejections?.map((r) => r.reason).join("; ") ?? "no series/episode match";
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
    seriesId: i.series!.id,
    seasonNumber: i.seasonNumber,
    episodes: i.episodes!.map((e) => ({ id: e.id })),
    quality: i.quality,
    languages: i.languages ?? [],
    releaseGroup: i.releaseGroup ?? "",
    downloadId: undefined,
  }));

  await client.post("/manualimport", payload);
  lines.push(`\nImported ${matched.length} file(s) successfully.`);
  return lines.join("\n");
}
