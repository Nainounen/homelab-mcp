import { z } from "zod";
import { BazarrClient } from "../bazarr.js";
import { bytes } from "../utils.js";

export const BazarrDownloadSchema = z.object({
  media_type: z.enum(["movie", "episode"]).describe("Type of media"),
  id: z.number().describe("Radarr movie ID or Sonarr episode ID"),
  language: z.string().optional().default("en").describe("Subtitle language code (default: en)"),
});

interface WantedItem {
  title: string;
  missing_subtitles: Array<{ name: string; code2: string }>;
  sonarrSeriesId?: number;
  radarrId?: number;
}

export async function bazarrGetStatus(client: BazarrClient): Promise<string> {
  const [movies, episodes] = await Promise.all([
    client.get<{ data: WantedItem[] }>("/api/movies/wanted?start=0&length=10"),
    client.get<{ data: WantedItem[] }>("/api/episodes/wanted?start=0&length=10"),
  ]);

  const lines: string[] = [];

  const movieWanted = movies.data ?? [];
  const epWanted    = episodes.data ?? [];

  lines.push(`Bazarr — Wanted subtitles`);
  lines.push(`  Movies missing subs: ${movieWanted.length}`);
  lines.push(`  Episodes missing subs: ${epWanted.length}`);

  if (movieWanted.length) {
    lines.push("\nMovies:");
    movieWanted.slice(0, 8).forEach((m) => {
      const langs = m.missing_subtitles.map((s) => s.code2).join(", ");
      lines.push(`  ${m.title} — missing: ${langs}`);
    });
  }

  if (epWanted.length) {
    lines.push("\nEpisodes:");
    epWanted.slice(0, 8).forEach((e) => {
      const langs = e.missing_subtitles.map((s) => s.code2).join(", ");
      lines.push(`  ${e.title} — missing: ${langs}`);
    });
  }

  return lines.join("\n");
}

export async function bazarrDownloadSubtitle(
  client: BazarrClient,
  input: z.infer<typeof BazarrDownloadSchema>
): Promise<string> {
  await client.post("/api/subtitles", {
    radarrid: input.media_type === "movie" ? input.id : undefined,
    sonarrepisodeid: input.media_type === "episode" ? input.id : undefined,
    language: input.language,
  });
  return `Triggered subtitle download for ${input.media_type} ID ${input.id} (language: ${input.language}).`;
}
