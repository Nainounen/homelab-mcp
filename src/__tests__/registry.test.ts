import { describe, it, expect } from "vitest";
import { ToolModule } from "../types.js";

/**
 * Replicate validateModules from registry.ts for independent testing.
 */
function validateModules(modules: ToolModule[]): void {
  const seen = new Map<string, string>();

  for (const mod of modules) {
    if (!mod.domain) throw new Error(`Module missing domain field`);

    for (const tool of mod.tools) {
      if (!tool.name) throw new Error(`Tool in module "${mod.domain}" has an empty name`);
      if (!tool.description) throw new Error(`Tool "${tool.name}" in module "${mod.domain}" has no description`);

      const existing = seen.get(tool.name);
      if (existing) {
        throw new Error(`Duplicate tool name "${tool.name}" found in both "${existing}" and "${mod.domain}"`);
      }
      seen.set(tool.name, mod.domain);
    }
  }
}

describe("validateModules", () => {
  it("accepts a valid module", () => {
    const modules: ToolModule[] = [
      {
        domain: "Test",
        tools: [
          {
            name: "test_do_thing",
            description: "Does a test thing",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
        ],
        handle: async () => "ok",
      },
    ];
    expect(() => validateModules(modules)).not.toThrow();
  });

  it("rejects empty module domain", () => {
    const modules: ToolModule[] = [
      { domain: "", tools: [], handle: async () => null },
    ];
    expect(() => validateModules(modules)).toThrow("Module missing domain field");
  });

  // Tool inputSchema type is strict in MCP SDK — use a cast for test mocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = { type: "object", properties: {}, required: [] };

  it("rejects tool with empty name", () => {
    const modules: ToolModule[] = [
      {
        domain: "Test",
        tools: [{ name: "", description: "test", inputSchema: schema }],
        handle: async () => null,
      },
    ];
    expect(() => validateModules(modules)).toThrow("empty name");
  });

  it("rejects tool with no description", () => {
    const modules: ToolModule[] = [
      {
        domain: "Test",
        tools: [{ name: "test_tool", description: "", inputSchema: schema }],
        handle: async () => null,
      },
    ];
    expect(() => validateModules(modules)).toThrow("no description");
  });

  it("rejects duplicate tool names across modules", () => {
    const tool = {
      name: "shared_tool",
      description: "A tool",
      inputSchema: schema,
    };
    const modules: ToolModule[] = [
      { domain: "Alpha", tools: [tool], handle: async () => null },
      { domain: "Beta", tools: [tool], handle: async () => null },
    ];
    expect(() => validateModules(modules)).toThrow("Duplicate tool name");
    expect(() => validateModules(modules)).toThrow("Alpha");
    expect(() => validateModules(modules)).toThrow("Beta");
  });
});
