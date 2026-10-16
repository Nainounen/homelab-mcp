import { describe, it, expect, vi } from "vitest";
import { BazarrClient } from "../bazarr.js";
import { operations, runOperation, setSettings, setProfiles, setLanguages, getSettings, redactBazarr } from "../tools/bazarr.js";
import { bazarrTools } from "../modules/bazarr.js";

const mockClient = () => ({ get: vi.fn().mockImplementation(async (path: string) => path === "/api/system/languages/profiles" ? [{ profileId: 1 }] : path === "/api/movies" ? { data: [{ radarrId: 1, profileId: 1 }] } : undefined), post: vi.fn(), request: vi.fn() });
const asClient = (client: ReturnType<typeof mockClient>) => client as unknown as BazarrClient;
describe("Bazarr API contract", () => {
  it("previews every API mutation without dispatching an HTTP request", async () => {
    for (const op of operations.filter(op => op.method !== "GET")) {
      expect(bazarrTools.find(t => t.name === op.name)?.inputSchema.properties).toHaveProperty("preview_only");
    }
    const c = mockClient();
    const op = operations.find(op => op.name === "bazarr_patch_movies_subtitles")!;
    const result = JSON.parse(await runOperation(asClient(c), op, { radarrid: 1, language: "en", forced: "false", hi: "false" }));
    expect(result.preview).toBe(true);
    expect(c.request).not.toHaveBeenCalled();
  });
  it("downloads with PATCH to the media-specific endpoint, never POST /subtitles", async () => {
    const c = mockClient();
    const op = operations.find(op => op.name === "bazarr_patch_movies_subtitles")!;
    await runOperation(asClient(c), op, { radarrid: 1, language: "en", forced: "false", hi: "false", preview_only: false });
    expect(c.request).toHaveBeenCalledWith("PATCH", "/api/movies/subtitles", { radarrid: 1, language: "en", forced: "false", hi: "false" }, undefined);
  });
  it("rejects mismatched profile arrays and invalid page sizes before HTTP", async () => {
    const c = mockClient();
    await expect(runOperation(asClient(c), operations.find(o => o.name === "bazarr_post_movies")!, { radarrid: [1, 2], profileid: ["1"], preview_only: false })).rejects.toThrow("equally sized");
    await expect(runOperation(asClient(c), operations.find(o => o.name === "bazarr_get_movies")!, { length: -1 })).rejects.toThrow();
    expect(c.request).not.toHaveBeenCalled();
  });
  it("sends text imports as multipart without reading a local file", async () => {
    const c = mockClient();
    await runOperation(asClient(c), operations.find(o => o.name === "bazarr_post_movies_subtitles")!, { radarrid: 1, language: "en", forced: "false", hi: "false", file: { filename: "movie.en.srt", content: "1\n00:00:00,000 --> 00:00:01,000\nHello" }, preview_only: false });
    expect(c.request.mock.calls[0][3]).toBeInstanceOf(FormData);
    expect((c.request.mock.calls[0][3] as FormData).get("file")).toBeInstanceOf(Blob);
  });
  it("requires a fresh settings preview and sends only changed form keys", async () => {
    const c = mockClient();
    c.get.mockResolvedValue({ sonarr: { port: 8989, apikey: "server-secret-value" } });
    const changes = { "settings-sonarr-port": 8990 };
    const preview = JSON.parse(await setSettings(asClient(c), { changes }));
    await expect(setSettings(asClient(c), { changes, preview_only: false, expected_hash: "0".repeat(64) })).rejects.toThrow("Settings changed");
    expect(c.post).not.toHaveBeenCalled();
    await setSettings(asClient(c), { changes, preview_only: false, expected_hash: preview.expected_hash });
    expect(c.post.mock.calls[0][1].toString()).toBe("settings-sonarr-port=8990");
  });
  it("does not replace profiles without the current revision", async () => {
    const c = mockClient();c.get.mockResolvedValue([]);
    await expect(setProfiles(asClient(c), { profiles: [], preview_only: false })).rejects.toThrow("Profiles changed");
    expect(c.post).not.toHaveBeenCalled();
  });
  it("requires a fresh language preview before replacing enabled languages", async () => {
    const c = mockClient(); c.get.mockResolvedValue([{ code2: "en", enabled: true }]);
    const preview = JSON.parse(await setLanguages(asClient(c), { languages: ["en"] }));
    await expect(setLanguages(asClient(c), { languages: ["en"], preview_only: false })).rejects.toThrow("expected_hash");
    expect(c.post).not.toHaveBeenCalled();
    await setLanguages(asClient(c), { languages: ["en"], expected_hash: preview.expected_hash, preview_only: false });
    expect(c.post.mock.calls[0][1].toString()).toBe("languages-enabled=en");
  });
  it("rejects removal of a profile still assigned to media", async () => {
    const c = mockClient();
    c.get.mockResolvedValueOnce([{ profileId: 1 }]).mockResolvedValueOnce({ data: [{ profileId: 1 }] });
    await expect(setProfiles(asClient(c), { profiles: [] })).rejects.toThrow("still assigned");
    expect(c.post).not.toHaveBeenCalled();
  });
  it("redacts section-specific notification settings", async () => {
    const c = mockClient();c.get.mockResolvedValue({ notifications: { providers: [{ url: "discord://sensitive-channel" }] } });
    const result = await getSettings(asClient(c), { section: "notifications" });
    expect(result).not.toContain("sensitive-channel");
  });
  it("rejects named and nonexistent default profiles before any settings write", async () => {
    for (const invalid of ["EN-IT-DE", 999, true]) {
      const c = mockClient();
      c.get.mockImplementation(async (path: string) => path === "/api/system/settings" ? { general: { movie_default_profile: 1, movie_default_enabled: true } } : [{ profileId: 1 }]);
      await expect(setSettings(asClient(c), { changes: { "settings-general-movie_default_profile": invalid }, preview_only: false })).rejects.toThrow("numeric profile ID");
      expect(c.post).not.toHaveBeenCalled();
    }
  });
  it("can disable a broken default without rewriting its stored reference", async () => {
    const c = mockClient();c.get.mockResolvedValue({ general: { serie_default_profile: "EN-IT-DE", serie_default_enabled: true } });
    expect(JSON.parse(await setSettings(asClient(c), { changes: { "settings-general-serie_default_enabled": false } })).preview).toBe(true);
    expect(c.post).not.toHaveBeenCalled();
  });
  it("accepts a valid numeric default profile in a preview", async () => {
    const c = mockClient();
    c.get.mockImplementation(async (path: string) => path === "/api/system/settings" ? { general: { movie_default_profile: "EN-IT-DE", movie_default_enabled: true } } : [{ profileId: 1 }]);
    const preview = JSON.parse(await setSettings(asClient(c), { changes: { "settings-general-movie_default_profile": 1 } }));
    expect(preview.preview).toBe(true);
    expect(c.post).not.toHaveBeenCalled();
  });
  it("blocks download of media with null or deleted profile, even on preview", async () => {
    for (const assigned of [null, 999]) {
      const c = mockClient();
      c.get.mockImplementation(async (path: string) => path === "/api/movies" ? { data: [{ radarrId: 1, profileId: assigned }] } : [{ profileId: 1 }]);
      await expect(runOperation(asClient(c), operations.find(o => o.name === "bazarr_patch_movies_subtitles")!, { radarrid: 1, language: "it", forced: "False", hi: "False" })).rejects.toThrow("No valid language profile");
      expect(c.request).not.toHaveBeenCalled();
    }
  });
  it("checks the episode's real series assignment", async () => {
    const c = mockClient();
    c.get.mockImplementation(async (path: string) => path === "/api/episodes" ? { data: [{ sonarrEpisodeId: 5, sonarrSeriesId: 2 }] } : path === "/api/series" ? { data: [{ sonarrSeriesId: 2, profileId: null }] } : [{ profileId: 1 }]);
    await expect(runOperation(asClient(c), operations.find(o => o.name === "bazarr_patch_episodes_subtitles")!, { seriesid: 2, episodeid: 5, language: "it", forced: "False", hi: "False", preview_only: false })).rejects.toThrow("No valid language profile");
    expect(c.request).not.toHaveBeenCalled();
  });
  it("supplies required audio flags for profile items before saving to Bazarr", async () => {
    const c = mockClient();c.get.mockResolvedValue([]);
    const profiles = [{ profileId: 1, name: "EN-IT-DE", cutoff: 1, items: [{ id: 1, language: "it", forced: "False", hi: "False" }], mustContain: [], mustNotContain: [], originalFormat: 0 }];
    const preview = JSON.parse(await setProfiles(asClient(c), { profiles }));
    await setProfiles(asClient(c), { profiles, expected_hash: preview.expected_hash, preview_only: false });
    const saved = JSON.parse(c.post.mock.calls[0][1].get("languages-profiles"));
    expect(saved[0].items[0].audio_exclude).toBe("False");
    expect(saved[0].items[0].audio_only_include).toBe("False");
  });
  it("redacts nested credentials and remembered values in logs", () => {
    const data = redactBazarr({ sonarr: { apikey: "unique-provider-secret" }, translator: { gemini_keys: ["hidden-key"] }, notifications: { providers: [{ url: "discord://private-hook" }] } });
    expect(JSON.stringify(data)).not.toContain("unique-provider-secret");
    expect(JSON.stringify(data)).not.toContain("hidden-key");
    expect(JSON.stringify(data)).not.toContain("private-hook");
    expect(redactBazarr("failure using unique-provider-secret")).toBe("failure using [redacted]");
  });
});
