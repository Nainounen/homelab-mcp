import { z } from "zod";
import { ArrClient, ArrCommand, ArrMediaFile, ArrLanguage, describeArrFile, filterArrLanguages, getArrRecords, listArrLanguages, listArrQualityProfiles, submitArrCommand } from "../arr.js";
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
  seriesId?: number;
  episodeId?: number;
  outputPath?: string;
  errorMessage?: string;
  trackedDownloadState?: string;
  statusMessages?: Array<{ title: string; messages: string[] }>;
  downloadId?: string;
  trackedDownloadStatus?: string;
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
  const records = await getArrRecords<SonarrQueueItem>(client, "/queue");
  if (!records.length) return "No active downloads in Sonarr queue.";
  return records.map((item) => {
    const pct = item.size > 0 ? (((item.size - item.sizeleft) / item.size) * 100).toFixed(1) : "?";
    const lines = [
      `[queueId:${item.id}] ${item.title}`,
      `  Status: ${item.status} | ${pct}% | ETA: ${item.timeleft ?? "unknown"} | ${item.protocol}`,
    ];
    if (item.downloadId) lines.push(`  Download ID: ${item.downloadId}`);
    if (item.trackedDownloadStatus) lines.push(`  Download status: ${item.trackedDownloadStatus}`);
    if (item.trackedDownloadState) lines.push(`  Download state: ${item.trackedDownloadState}`);
    if (item.outputPath) lines.push(`  Output path: ${item.outputPath}`);
    if (item.errorMessage) lines.push(`  Error: ${item.errorMessage}`);
    for (const warning of item.statusMessages ?? []) {
      lines.push(`  ${warning.title}: ${warning.messages.join("; ")}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

export const SonarrCommandStatusSchema = z.object({
  command_id: z.number().int().positive().describe("Command ID returned by a submitted operation"),
});

export async function sonarrGetCommand(
  client: ArrClient,
  input: z.infer<typeof SonarrCommandStatusSchema>
): Promise<string> {
  const command = await client.get<ArrCommand>(`/command/${input.command_id}`);
  return `[commandId:${command.id}] ${command.name ?? "Command"} | Status: ${command.status}${command.message ? `\n${command.message}` : ""}`;
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
  const records = await getArrRecords<{ id: number }>(client, "/queue");
  if (!records.length) return "Sonarr queue is already empty.";
  const ids = [...new Set(records.map((r) => r.id))];
  await client.deleteWithBody("/queue/bulk", { ids }, { removeFromClient: true, blocklist: false });
  return `Cleared ${ids.length} item(s) from Sonarr queue.`;
}

export async function sonarrClearBlocklist(client: ArrClient): Promise<string> {
  const records = await getArrRecords<{ id: number }>(client, "/blocklist");
  if (!records.length) return "Sonarr blocklist is already empty.";
  const ids = records.map((r) => r.id);
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
  const match = existing.find((m) => m.host.toLowerCase() === input.host.toLowerCase() && m.remotePath === input.remote_path);
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
  const records = await getArrRecords<SonarrQueueItem>(client, "/queue");
  const item = records.find((r) => r.id === input.queue_id);
  if (!item) throw new Error(`No queue item with id ${input.queue_id}`);

  await client.delete(`/queue/${input.queue_id}`, { blocklist: true, removeFromClient: true });

  if (!input.retry) return `Blocklisted and removed "${item.title}" from queue.`;

  const affected = records.filter((r) => r.id === item.id || (item.downloadId && r.downloadId === item.downloadId));
  const episodeIds = [...new Set(affected.flatMap((r) => r.episodeId ? [r.episodeId] : []))];
  if (episodeIds.length) {
    await client.post("/command", { name: "EpisodeSearch", episodeIds });
    return `Blocklisted "${item.title}", removed from queue, and triggered a search for ${episodeIds.length} affected episode(s).`;
  }
  return `Blocklisted and removed "${item.title}" from queue. No retry submitted because the queue did not identify the affected episodes.`;
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

  const releases = await client.get<Array<{ title: string; rejections: string[]; size?: number; quality?: { quality?: { name: string } } }>>("/release", { seriesId: s.id, seasonNumber: seasonNum });

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
  languages?: ArrLanguage[];
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
  fullSeason?: boolean;
}

export const SonarrInteractiveSearchSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series"),
  season: z.number().describe("Season number to search"),
  episode: z.number().optional().describe("Episode number — omit to search the entire season"),
  include_rejected: z.boolean().optional().default(false).describe("Also show rejected releases (default: false)"),
  limit: z.number().int().min(1).max(100).optional().default(20).describe("Maximum releases to show (default 20, maximum 100)"),
  language: z.string().trim().min(1).optional().describe("Filter by a reported language name, such as German or English. Use include_rejected: true for alternatives to existing files."),
});

export const SonarrGrabReleaseSchema = z.object({
  tvdb_id: z.number().describe("TVDB ID of the series (same as used in sonarr_interactive_search)"),
  guid: z.string().describe("Release GUID from sonarr_interactive_search output"),
  season: z.number().describe("Season number — must match what was used in sonarr_interactive_search"),
  episode: z.number().optional().describe("Episode number — must match if sonarr_interactive_search was called with one"),
  indexer_id: z.number().int().positive().optional().describe("Indexer ID shown alongside the release GUID"),
  allow_rejected: z.boolean().optional().default(false).describe("Allow a rejected release only after its rejection reasons have been reviewed and explicitly approved"),
  preview_only: z.boolean().optional().default(true).describe("Preview the selected download and replacement risk (default true). Apply only after human approval."),
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

  const ep = input.episode !== undefined
    ? episodes.find((e) => e.episodeNumber === input.episode)
    : episodes[0];
  if (!ep) throw new Error(`Episode ${input.episode} not found in S${String(input.season).padStart(2, "0")}`);

  const releases = await client.get<Release[]>("/release", input.episode !== undefined
    ? { episodeId: ep.id }
    : { seriesId: s.id, seasonNumber: input.season });
  const relevant = filterArrLanguages(releases, input.language);

  const grabbable = relevant.filter((r) => !r.rejections?.length);
  const rejected = relevant.filter((r) => r.rejections?.length);
  const shown = [...(input.include_rejected ? relevant : grabbable)].sort((a, b) => (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0));

  if (!relevant.length) return `No releases match${input.language ? ` language "${input.language}"` : ""}. Language filtering uses reported release metadata, not verified audio tracks.`;

  if (!shown.length) {
    return `No grabbable releases for "${s.title}" S${String(input.season).padStart(2, "0")} (${rejected.length} rejected). Pass include_rejected: true to see why.`;
  }

  const epLabel = input.episode !== undefined
    ? `S${String(input.season).padStart(2, "0")}E${String(input.episode).padStart(2, "0")}`
    : `S${String(input.season).padStart(2, "0")}`;

  const lines: string[] = [
    `Interactive search for "${s.title}" ${epLabel} — ${grabbable.length} grabbable, ${rejected.length} rejected:\n`,
    "Pass the guid to sonarr_grab_release to download a specific release.\n",
  ];

  lines.push(`Showing ${Math.min(shown.length, input.limit)} of ${shown.length} matching releases, highest profile custom-format score first (limit: ${input.limit}, maximum 100).\n`);
  shown.slice(0, input.limit).forEach((r, i) => {
    const q = r.quality?.quality?.name ?? "?";
    const size = bytes(r.size);
    const age = `${r.age}d`;
    const score = r.customFormatScore !== undefined ? ` | CF score: ${r.customFormatScore > 0 ? "+" : ""}${r.customFormatScore}` : "";
    const pack = r.fullSeason ? " [SEASON PACK]" : "";
    const status = r.rejections?.length ? ` REJECTED: ${r.rejections.join("; ")}` : " Allowed";
    const languages = r.languages?.map((language) => language.name).join(", ") || "unknown";
    const formats = r.customFormats?.map((format) => format.name).join(", ") || "none reported";
    lines.push(`[${i + 1}] guid:${r.guid} | indexerId:${r.indexerId}`);
    lines.push(`     ${r.title}${pack}`);
    lines.push(`     ${q} | ${size} | ${age} old | ${r.indexer ?? r.indexerId} | Languages: ${languages}${score} | Matched formats: ${formats}${status}`);
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
  const ep = input.episode !== undefined
    ? episodes.find((e) => e.episodeNumber === input.episode)
    : episodes[0];
  if (!ep) throw new Error(`Episode not found in S${String(input.season).padStart(2, "0")}`);

  const releases = await client.get<Release[]>("/release", input.episode !== undefined
    ? { episodeId: ep.id }
    : { seriesId: s.id, seasonNumber: input.season });
  const matches = releases.filter((r) => r.guid === input.guid && (input.indexer_id === undefined || r.indexerId === input.indexer_id));
  if (matches.length > 1) throw new Error("This GUID appears on multiple indexers. Provide indexer_id from the search results.");
  const release = matches[0];
  if (!release) throw new Error(`Release with guid "${input.guid}" not found. Re-run sonarr_interactive_search to get fresh GUIDs.`);

  const languages = release.languages?.map((language) => language.name).join(", ") || "unknown";
  const warnings = release.rejections?.join("; ") || "none";
  if (input.preview_only) return `Preview only: "${release.title}" | Languages: ${languages} | Rejections: ${warnings}. Importing this release may replace existing media. After human approval, set preview_only: false to download${release.rejections?.length ? " and allow_rejected: true to acknowledge the rejection reasons" : ""}.`;
  if (release.rejections?.length && !input.allow_rejected) throw new Error(`Release rejected: ${warnings}. Review these reasons and obtain human approval before setting allow_rejected: true.`);
  await client.post("/release", release);
  const q = release.quality?.quality?.name ?? "?";
  return `Grabbing "${release.title}" [${q}] — check sonarr_get_queue to monitor progress.`;
}

// ─── Manual import ────────────────────────────────────────────────────────────

interface SonarrManualImportItem {
  folderName?: string;
  downloadId?: string;
  indexerFlags?: number;
  releaseType?: string;
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
  preview_only: z.boolean().optional().default(true).describe("Show matches without importing (default true). Set false to submit an import."),
  import_mode: z.enum(["auto", "copy", "move"]).optional().default("copy").describe("Import mode (default copy preserves source files; move removes them; auto lets the service decide)"),
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
      const reason = i.rejections?.map((r) => r.reason).join("; ") || "no series/episode match";
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
    folderName: i.folderName,
    indexerFlags: i.indexerFlags ?? 0,
    releaseType: i.releaseType,
    seriesId: i.series!.id,
    seasonNumber: i.seasonNumber,
    episodeIds: i.episodes!.map((e) => e.id),
    quality: i.quality,
    languages: i.languages ?? [],
    releaseGroup: i.releaseGroup ?? "",
    downloadId: i.downloadId,
  }));

  const command = await client.post<ArrCommand>("/command", {
    name: "ManualImport",
    files: payload,
    importMode: input.import_mode,
  });
  lines.push(`\nSubmitted import of ${matched.length} file(s). [commandId:${command.id}] Status: ${command.status}. Use sonarr_get_command to check completion.`);
  return lines.join("\n");
}

export const SonarrExistingItemSchema = z.object({
  tvdb_id: z.number().int().positive().describe("External ID of an existing library item"),
  preview_only: z.boolean().optional().default(true).describe("Preview the change (default true). Apply only after human approval."),
});

export const SonarrSetQualityProfileSchema = SonarrExistingItemSchema.extend({
  quality_profile: z.string().trim().min(1).describe("Exact name from sonarr_list_quality_profiles"),
});

export async function sonarrListLanguages(client: ArrClient): Promise<string> {
  return listArrLanguages(client);
}
export async function sonarrListQualityProfiles(client: ArrClient): Promise<string> {
  return listArrQualityProfiles(client);
}

export async function sonarrRefreshSeries(client: ArrClient, input: z.infer<typeof SonarrExistingItemSchema>): Promise<string> {
  const item = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!item) throw new Error("Item not found in the library");
  return submitArrCommand(client, "RefreshSeries", { seriesIds: [item.id] }, input.preview_only, "sonarr_get_command");
}

export async function sonarrRescanSeries(client: ArrClient, input: z.infer<typeof SonarrExistingItemSchema>): Promise<string> {
  const item = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!item) throw new Error("Item not found in the library");
  return submitArrCommand(client, "RescanSeries", { seriesId: item.id }, input.preview_only, "sonarr_get_command");
}

export async function sonarrSetQualityProfile(client: ArrClient, input: z.infer<typeof SonarrSetQualityProfileSchema>): Promise<string> {
  const item = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!item) throw new Error("Item not found in the library");
  const profiles = await client.get<QualityProfile[]>("/qualityprofile");
  const profile = profiles.find((candidate) => candidate.name.toLowerCase() === input.quality_profile.toLowerCase());
  if (!profile) throw new Error(`Quality profile not found. Available: ${profiles.map((candidate) => candidate.name).join(", ")}`);
  if (item.qualityProfileId === profile.id) return `"${item.title}" already uses "${profile.name}".`;
  const previous = profiles.find((candidate) => candidate.id === item.qualityProfileId)?.name ?? String(item.qualityProfileId);
  if (input.preview_only) return `Preview only: "${item.title}": "${previous}" -> "${profile.name}". This may allow future upgrades. After human approval, set preview_only: false to apply.`;
  await client.put("/series/" + item.id, { ...item, qualityProfileId: profile.id });
  return `Updated "${item.title}" to quality profile "${profile.name}". No immediate search was submitted.`;
}

interface SonarrEpisode {
  id: number;
  episodeFileId?: number;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  monitored: boolean;
  hasFile: boolean;
  airDateUtc?: string;
}

export const SonarrInspectEpisodesSchema = z.object({
  tvdb_id: z.number().int().positive(),
  season: z.number().int().min(0).optional(),
  episode: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
}).refine((input) => input.episode === undefined || input.season !== undefined, {
  message: "Provide season when selecting an episode",
  path: ["season"],
});

async function getInspectedEpisodes(client: ArrClient, input: z.infer<typeof SonarrInspectEpisodesSchema>): Promise<{ series: SonarrSeries; episodes: SonarrEpisode[] }> {
  const series = await getSeriesByTvdbId(client, input.tvdb_id);
  if (!series) throw new Error("Series not found in the library");
  const episodes = await client.get<SonarrEpisode[]>("/episode", { seriesId: series.id, seasonNumber: input.season });
  const selected = episodes.filter((episode) => input.episode === undefined || episode.episodeNumber === input.episode);
  selected.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  return { series, episodes: selected };
}

export async function sonarrListEpisodes(client: ArrClient, input: z.infer<typeof SonarrInspectEpisodesSchema>): Promise<string> {
  const { series, episodes } = await getInspectedEpisodes(client, input);
  if (!episodes.length) return "No episodes match this selection.";
  const lines = episodes.slice(0, input.limit).map((episode) =>
    `[episodeId:${episode.id}] S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")} ${episode.title} | Monitored: ${episode.monitored} | Downloaded: ${episode.hasFile} | Air date: ${episode.airDateUtc ?? "unknown"} | File ID: ${episode.episodeFileId ?? "none"}`
  );
  return `${series.title}: showing ${lines.length} of ${episodes.length} episodes.\n` + lines.join("\n");
}

export async function sonarrListEpisodeFiles(client: ArrClient, input: z.infer<typeof SonarrInspectEpisodesSchema>): Promise<string> {
  const { series, episodes } = await getInspectedEpisodes(client, input);
  const selectedIds = new Set(episodes.filter((episode) => episode.hasFile).map((episode) => episode.episodeFileId));
  const files = (await client.get<ArrMediaFile[]>("/episodefile", { seriesId: series.id })).filter((file) => selectedIds.has(file.id));
  if (!files.length) return "No downloaded episode files match this selection.";
  const shown = files.slice(0, input.limit);
  return `${series.title}: showing ${shown.length} of ${files.length} files.\n` + shown.map(describeArrFile).join("\n\n");
}
