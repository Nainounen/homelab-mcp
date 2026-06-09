import { z } from "zod";
import { ArrClient } from "../arr.js";
import { bytes, getFirstQualityProfileId } from "../utils.js";

interface LidarrArtist {
  id: number;
  artistName: string;
  monitored: boolean;
  status: string;
  statistics?: { albumCount: number; trackFileCount: number; sizeOnDisk: number };
}

interface LidarrQueueItem {
  id: number;
  title: string;
  status: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  protocol: string;
}

export const LidarrSearchSchema = z.object({
  name: z.string().describe("Artist name to search for"),
});

export const LidarrAddArtistSchema = z.object({
  mbid: z.string().optional().describe("MusicBrainz ID (from lidarr_search_artist)"),
  name: z.string().optional().describe("Artist name (auto-lookup if mbid not provided)"),
  quality_profile: z.string().optional().describe("Quality profile name (default: first available)"),
});

export const LidarrRemoveArtistSchema = z.object({
  id: z.number().describe("Lidarr artist ID (from lidarr_list_artists)"),
  delete_files: z.boolean().optional().default(false).describe("Also delete downloaded files"),
});

export async function lidarrSearchArtist(
  client: ArrClient,
  input: z.infer<typeof LidarrSearchSchema>
): Promise<string> {
  const results = await client.get<LidarrArtist[]>("/artist/lookup", { term: input.name });
  if (!results.length) return "No results found.";
  return results.slice(0, 8).map((a) => {
    const albums = a.statistics?.albumCount ?? "?";
    return `[id: ${(a as unknown as { foreignArtistId?: string }).foreignArtistId ?? a.id}] ${a.artistName} — ${albums} album(s) | ${a.status}`;
  }).join("\n");
}

export async function lidarrListArtists(client: ArrClient): Promise<string> {
  const artists = await client.get<LidarrArtist[]>("/artist");
  if (!artists.length) return "No artists in Lidarr library.";
  return [...artists]
    .sort((a, b) => a.artistName.localeCompare(b.artistName))
    .map((a) => {
      const stats = a.statistics
        ? `${a.statistics.albumCount} albums | ${bytes(a.statistics.sizeOnDisk)}`
        : a.status;
      return `[${a.id}] ${a.artistName} — ${stats}`;
    }).join("\n");
}

export async function lidarrGetQueue(client: ArrClient): Promise<string> {
  const q = await client.get<{ records: LidarrQueueItem[] }>("/queue");
  if (!q.records.length) return "No active downloads in Lidarr queue.";
  return q.records.map((item) => {
    const pct = item.size > 0 ? (((item.size - item.sizeleft) / item.size) * 100).toFixed(1) : "?";
    return `[${item.id}] ${item.title}\n  ${item.status} | ${pct}% | ETA: ${item.timeleft ?? "unknown"}`;
  }).join("\n\n");
}

export async function lidarrAddArtist(
  client: ArrClient,
  input: z.infer<typeof LidarrAddArtistSchema>
): Promise<string> {
  const rootFolder = process.env.LIDARR_ROOT_FOLDER;
  if (!rootFolder) throw new Error("LIDARR_ROOT_FOLDER is not set in .env");

  const results = await client.get<Array<{ foreignArtistId: string; artistName: string }>>(
    "/artist/lookup",
    { term: input.mbid ? `lidarr:${input.mbid}` : input.name }
  );
  if (!results.length) throw new Error("Artist not found");

  const profileId = await getFirstQualityProfileId(client, "Lidarr");
  const artist    = results[0];

  await client.post("/artist", {
    foreignArtistId: artist.foreignArtistId,
    artistName: artist.artistName,
    qualityProfileId: profileId,
    rootFolderPath: rootFolder,
    monitored: true,
    addOptions: { searchForMissingAlbums: true },
  });

  return `Added "${artist.artistName}" to Lidarr.`;
}

export async function lidarrRemoveArtist(
  client: ArrClient,
  input: z.infer<typeof LidarrRemoveArtistSchema>
): Promise<string> {
  const artists = await client.get<LidarrArtist[]>("/artist");
  const artist  = artists.find((a) => a.id === input.id);
  if (!artist) throw new Error(`No artist with id ${input.id}`);
  await client.delete(`/artist/${artist.id}`, { deleteFiles: input.delete_files });
  return `Removed "${artist.artistName}" from Lidarr${input.delete_files ? " (files deleted)" : ""}.`;
}
