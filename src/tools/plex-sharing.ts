import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { getPlexClient } from "./plex.js";

interface Section { id: string; key: string; title: string; type: string; shared?: string }
interface Share {
  id: string; email?: string; username?: string; acceptedAt?: string; invitedAt?: string;
  allLibraries?: string; allowSync?: string; Section?: Section[];
}
interface CloudServer { machineIdentifier: string; owned: string; Section?: Section[] }

export const PlexInviteSchema = z.object({
  email: z.string().trim().email().max(254),
  library_keys: z.array(z.string().regex(/^\d+$/)).min(1).max(50),
  allow_downloads: z.boolean().default(false),
  preview_only: z.boolean().default(true),
}).strict();

function cloudClient() {
  const token = process.env.PLEX_TOKEN;
  if (!token) throw new Error("Missing PLEX_TOKEN.");
  return axios.create({ baseURL: "https://plex.tv", timeout: 15_000, maxRedirects: 0,
    maxContentLength: 1_000_000, headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": "homelab-mcp", Accept: "application/xml" } });
}

function xmlContainer(data: unknown): Record<string, unknown> {
  if (typeof data !== "string" || /<!DOCTYPE|<!ENTITY/i.test(data)) throw new Error("Unexpected Plex sharing response.");
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false,
    isArray: name => ["Server", "SharedServer", "Section"].includes(name) }).parse(data);
  if (!parsed.MediaContainer) throw new Error("Plex sharing response could not be verified.");
  return parsed.MediaContainer;
}

async function sharingContext() {
  const local = await getPlexClient().get("/");
  const machine = local.data?.MediaContainer?.machineIdentifier;
  if (typeof machine !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(machine)) throw new Error("Plex server identity is unavailable.");
  const cloud = cloudClient();
  const path = `/api/servers/${encodeURIComponent(machine)}`;
  const response = await cloud.get(path);
  const servers = xmlContainer(response.data).Server as CloudServer[] | undefined;
  const server = servers?.find(row => row.machineIdentifier === machine && row.owned === "1");
  if (!server || !Array.isArray(server.Section)) throw new Error("Plex token must own this server and its cloud libraries must be available.");
  return { cloud, path, machine, name: local.data.MediaContainer.friendlyName, sections: server.Section };
}

async function readShares(context: Awaited<ReturnType<typeof sharingContext>>): Promise<Share[]> {
  const response = await context.cloud.get(context.path + "/shared_servers");
  const shares = xmlContainer(response.data).SharedServer;
  if (shares !== undefined && !Array.isArray(shares)) throw new Error("Plex shares could not be verified.");
  return (shares ?? []) as Share[];
}

export async function plexListShares(): Promise<string> {
  const context = await sharingContext();
  const shares = await readShares(context);
  // Return selected fields only: Plex supplies per-user access tokens in this response.
  return JSON.stringify({ server: context.name, shares: shares.map(row => ({
    share_id: row.id, email: row.email, username: row.username,
    status: row.acceptedAt && row.acceptedAt !== "0" ? "accepted" : "pending",
    downloads_allowed: row.allowSync === "1", all_libraries: row.allLibraries === "1",
    libraries: (row.Section ?? []).filter(section => section.shared === "1").map(section => ({ key: section.key, title: section.title })),
  })) });
}

export async function plexInviteUser(input: z.infer<typeof PlexInviteSchema>): Promise<string> {
  const context = await sharingContext();
  const libraries = [...new Set(input.library_keys)].map(key => {
    const section = context.sections.find(row => row.key === key);
    if (!section || !/^\d+$/.test(section.id) || !Number.isSafeInteger(Number(section.id)) || Number(section.id) <= 0) throw new Error("Requested library is unavailable for sharing. Read plex_get_libraries again.");
    return section;
  });
  const shares = await readShares(context);
  const existing = shares.find(row => row.email?.toLowerCase() === input.email.toLowerCase());
  if (existing) return JSON.stringify({ invitation_sent: false, existing_share: true,
    share_id: existing.id, note: "This email already has a pending or accepted share. No invitation or access change was made." });
  const preview = { email: input.email, server: context.name,
    libraries: libraries.map(section => ({ key: section.key, title: section.title })),
    downloads_allowed: input.allow_downloads, plex_home_member: false, preview: input.preview_only };
  if (input.preview_only) return JSON.stringify(preview);
  try {
    await context.cloud.post(context.path + "/shared_servers", {
      server_id: context.machine,
      shared_server: { library_section_ids: libraries.map(section => Number(section.id)), invited_email: input.email },
      sharing_settings: { allowSync: input.allow_downloads ? "1" : "0", allowCameraUpload: "0", allowChannels: "0", allowTuners: "0", allowSubtitleAdmin: "0" },
    }, { headers: { "Content-Type": "application/json" } });
  } catch {
    throw new Error("Plex invitation did not return confirmed success. Check plex_list_shares before retrying; it may have been created.");
  }
  let verified = false;
  try { verified = (await readShares(context)).some(row => row.email?.toLowerCase() === input.email.toLowerCase()); } catch { /* Submission succeeded; verification can be retried without resending. */ }
  return JSON.stringify({ ...preview, invitation_submitted: true, share_verified: verified,
    note: "Recipient must accept Plex's invitation. Submission does not establish email delivery or recipient acceptance." });
}
