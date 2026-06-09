import { z } from "zod";
import { TautulliClient } from "../tautulli.js";

export const TautulliHistorySchema = z.object({
  limit: z.number().optional().default(20).describe("Number of history entries to return (default 20)"),
  user: z.string().optional().describe("Filter by Plex username"),
});

interface TautulliSession {
  user: string;
  full_title: string;
  media_type: string;
  state: string;
  progress_percent: string;
  stream_video_decision: string;
  stream_audio_decision: string;
  player: string;
  quality_profile: string;
}

interface TautulliHistoryRecord {
  user: string;
  full_title: string;
  media_type: string;
  date: number;
  duration: number;
  percent_complete: number;
  player: string;
}

interface TautulliStat {
  stat_id: string;
  stat_type: string;
  rows: Array<{ title: string; total_plays: number; users_watched?: string }>;
}

export async function tautulliGetActivity(client: TautulliClient): Promise<string> {
  const data = await client.cmd<{ sessions: TautulliSession[]; stream_count: string }>("get_activity");
  if (!data.sessions?.length) return "No active streams on Plex right now.";

  return data.sessions.map((s) => {
    const decision = `${s.stream_video_decision}/${s.stream_audio_decision}`;
    return `${s.user} → ${s.full_title}\n  ${s.player} | ${decision} | ${s.progress_percent}% | ${s.state}`;
  }).join("\n\n");
}

export async function tautulliGetHistory(
  client: TautulliClient,
  input: z.infer<typeof TautulliHistorySchema>
): Promise<string> {
  const params: Record<string, string | number> = { length: input.limit };
  if (input.user) params.user = input.user;

  const data = await client.cmd<{ data: TautulliHistoryRecord[] }>("get_history", params);
  if (!data.data?.length) return "No watch history found.";

  return data.data.map((r) => {
    const date = new Date(r.date * 1000).toLocaleDateString();
    const dur  = `${Math.floor(r.duration / 60)}m`;
    const pct  = `${r.percent_complete}%`;
    return `${date} | ${r.user} | ${r.full_title} | ${dur} (${pct}) | ${r.player}`;
  }).join("\n");
}

export async function tautulliGetStats(client: TautulliClient): Promise<string> {
  const data = await client.cmd<TautulliStat[]>("get_home_stats", { time_range: 30, stats_count: 5 });
  if (!data?.length) return "No stats available.";

  const lines: string[] = ["Tautulli — Top stats (last 30 days)\n"];
  for (const stat of data) {
    if (!stat.rows?.length) continue;
    lines.push(`${stat.stat_id.replace(/_/g, " ").toUpperCase()}`);
    stat.rows.slice(0, 5).forEach((r, i) =>
      lines.push(`  ${i + 1}. ${r.title} — ${r.total_plays} play(s)`)
    );
    lines.push("");
  }
  return lines.join("\n");
}
