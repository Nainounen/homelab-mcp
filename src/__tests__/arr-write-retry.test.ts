import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { ArrClient, WriteOutcomeUnknownError } from "../arr.js";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: http.Server[] = [];

async function startServer(handler: Handler): Promise<{ url: string; hits: () => number }> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, hits: () => count };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => {
    s.closeAllConnections();
    s.close(() => resolve());
  })));
});

describe("ArrClient.post write safety", () => {
  it("does not retry a POST that got a 5xx answer and reports the outcome as unknown", async () => {
    const srv = await startServer((_req, res) => { res.statusCode = 503; res.end("busy"); });
    const client = new ArrClient(srv.url, "test-key");
    const err: any = await client.post("/release", { guid: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(err.message).toContain("POST /release outcome unknown (HTTP 503)");
    expect(srv.hits()).toBe(1);
  });

  it("does not retry a POST whose connection was reset after sending", async () => {
    const srv = await startServer((req) => { req.socket.destroy(); });
    const client = new ArrClient(srv.url, "test-key");
    const err: any = await client.post("/command", { name: "SeasonSearch" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(err.message).toContain("outcome unknown");
    expect(srv.hits()).toBe(1);
  });

  it("passes a 4xx rejection through unchanged without retry", async () => {
    const srv = await startServer((_req, res) => { res.statusCode = 400; res.end("bad"); });
    const client = new ArrClient(srv.url, "test-key");
    const err: any = await client.post("/release", {}).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(WriteOutcomeUnknownError);
    expect(err.response?.status).toBe(400);
    expect(srv.hits()).toBe(1);
  });

  it("returns data on success with a single request", async () => {
    const srv = await startServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: 7, status: "queued" }));
    });
    const client = new ArrClient(srv.url, "test-key");
    await expect(client.post("/command", { name: "RssSync" })).resolves.toEqual({ id: 7, status: "queued" });
    expect(srv.hits()).toBe(1);
  });

  it("keeps a refused connection as a definite failure, not an unknown outcome", async () => {
    const srv = await startServer((_req, res) => res.end());
    const url = srv.url;
    await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
    const client = new ArrClient(url, "test-key");
    const prev = process.env.HTTP_RETRIES;
    process.env.HTTP_RETRIES = "0";
    try {
      const err: any = await client.post("/command", {}).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(WriteOutcomeUnknownError);
      expect(err.code).toBe("ECONNREFUSED");
    } finally {
      if (prev === undefined) delete process.env.HTTP_RETRIES; else process.env.HTTP_RETRIES = prev;
    }
  });
});
