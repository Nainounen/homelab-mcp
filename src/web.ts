#!/usr/bin/env node
import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { webTools, WebSearchSchema, WebFetchSchema, webSearch, webFetch } from "./tools/web.js";
import { version } from "../package.json";

process.umask(0o077);

// This entrypoint only loads the dedicated web credential file, never media or infrastructure clients.
dotenv.config({ path: process.env.HOMELAB_WEB_ENV_FILE ?? "/etc/homelab-mcp/web.env" });
const server = new Server({ name: "homelab-web-mcp", version }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: webTools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const args = request.params.arguments ?? {};
    let result: string;
    switch (request.params.name) {
      case "web_search": result = await webSearch(WebSearchSchema.parse(args)); break;
      case "web_fetch": result = await webFetch(WebFetchSchema.parse(args)); break;
      default: throw new Error("Unknown public-web tool.");
    }
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const key = process.env.DEEPSEEK_API_KEY;
    const message = error instanceof z.ZodError ? "Invalid public-web arguments or unexpected provider response." : error instanceof Error ? error.message : "Public-web request failed.";
    return { content: [{ type: "text", text: (key ? message.split(key).join("[redacted]") : message).slice(0, 1000) }], isError: true };
  }
});
server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write("Public-web MCP transport failed.\n");
  process.exit(1);
});
