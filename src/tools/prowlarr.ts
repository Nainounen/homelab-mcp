import { z } from "zod";
import { ProwlarrClient } from "../prowlarr.js";

interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  tags: number[];
}

interface ProwlarrApp {
  id: number;
  name: string;
  syncLevel: string;
}

export const ProwlarrTestIndexerSchema = z.object({
  indexer_id: z.number().optional().describe("Indexer ID to test (tests all if omitted)"),
});

export async function prowlarrListIndexers(client: ProwlarrClient): Promise<string> {
  const indexers = await client.get<ProwlarrIndexer[]>("/indexer");
  if (!indexers.length) return "No indexers configured.";
  return indexers
    .map((i) => `[${i.id}] ${i.name} | ${i.protocol} | ${i.enable ? "enabled" : "disabled"}`)
    .join("\n");
}

export async function prowlarrSyncApps(client: ProwlarrClient): Promise<string> {
  const apps = await client.get<ProwlarrApp[]>("/applications");
  if (!apps.length) return "No apps connected to Prowlarr.";
  await client.post("/command", { name: "ApplicationIndexerSync" });
  return `Synced indexers to: ${apps.map((a) => a.name).join(", ")}`;
}

export async function prowlarrTestIndexers(
  client: ProwlarrClient,
  input: z.infer<typeof ProwlarrTestIndexerSchema>
): Promise<string> {
  if (input.indexer_id) {
    await client.post(`/indexer/${input.indexer_id}/test`);
    return `Test triggered for indexer ${input.indexer_id}.`;
  }
  await client.post("/indexer/testall");
  return "Test triggered for all indexers. Check Prowlarr UI for results.";
}
