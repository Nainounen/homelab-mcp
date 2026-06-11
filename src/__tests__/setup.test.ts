import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { homelabSetup, SetupSchema } from "../tools/setup.js";

/**
 * Setup wizard tests.
 *
 * These test the .env read/write and status logic using real temp directories.
 * An empty .env is created in the temp dir to prevent envPath() from falling
 * back to the real project .env via __dirname. All filesystem I/O is confined
 * to the temp directory.
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(path.resolve("/tmp"), "homelab-mcp-test-"));
  // Create an empty .env so envPath() finds it first (prevents __dirname fallback)
  fs.writeFileSync(path.join(tmpDir, ".env"), "");
  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Overwrite the .env file with the given content. */
function writeEnv(content: string): void {
  fs.writeFileSync(path.join(tmpDir, ".env"), content);
}

/** Read the current .env file content. */
function readEnv(): string {
  return fs.readFileSync(path.join(tmpDir, ".env"), "utf8");
}

describe("homelabSetup — status", () => {
  it("reports 0 configured when .env is empty", async () => {
    const result = await homelabSetup({ action: "status", updates: [] });
    expect(result).toContain("Homelab Setup");
    expect(result).toContain("0/");
  });

  it("reports configured vars from an existing .env", async () => {
    writeEnv("PROXMOX_HOST=192.168.1.10\nDEVBOX_HOST=10.0.0.2\n# comment line\n");

    const result = await homelabSetup({ action: "status", updates: [] });
    expect(result).toContain("PROXMOX_HOST");
    expect(result).toContain("192.168.1.10");
    expect(result).toContain("DEVBOX_HOST");
    expect(result).toContain("10.0.0.2");
  });

  it("masks secret values in status output", async () => {
    writeEnv("PROXMOX_HOST=192.168.1.10\nRADARR_API_KEY=super-secret-key-12345\n");

    const result = await homelabSetup({ action: "status", updates: [] });
    expect(result).toContain("192.168.1.10"); // non-secret: visible
    expect(result).not.toContain("super-secret-key-12345"); // secret: masked
    expect(result).toContain("••••••••"); // masking indicator
  });

  it("strips surrounding quotes from values", async () => {
    writeEnv('PROXMOX_HOST="192.168.1.10"\nDEVBOX_HOST=\'10.0.0.2\'\n');

    const result = await homelabSetup({ action: "status", updates: [] });
    expect(result).toContain("192.168.1.10");
    expect(result).toContain("10.0.0.2");
    expect(result).not.toContain('"192.168.1.10"');
    expect(result).not.toContain("'10.0.0.2'");
  });

  it("shows progress percentage", async () => {
    writeEnv("PROXMOX_HOST=192.168.1.10\n");

    const result = await homelabSetup({ action: "status", updates: [] });
    expect(result).toContain("%"); // has a percentage
    expect(result).toContain("Missing — Required"); // still has missing vars
  });
});

describe("homelabSetup — configure", () => {
  it("creates .env from .env.example when .env is empty", async () => {
    // Create .env.example in the temp dir
    fs.writeFileSync(
      path.join(tmpDir, ".env.example"),
      "# Example config\nPROXMOX_HOST=\nDEVBOX_HOST=\n"
    );

    const result = await homelabSetup({
      action: "configure",
      updates: [{ key: "PROXMOX_HOST", value: "10.0.0.1" }],
    });

    // Should have saved and reported
    expect(result).toContain("Saved 1 setting");

    // Verify file was written
    const envContent = readEnv();
    expect(envContent).toContain("PROXMOX_HOST=10.0.0.1");
  });

  it("updates an existing key in place", async () => {
    writeEnv("PROXMOX_HOST=old-host\nDEVBOX_HOST=10.0.0.2\n");

    await homelabSetup({
      action: "configure",
      updates: [{ key: "PROXMOX_HOST", value: "new-host" }],
    });

    const envContent = readEnv();
    expect(envContent).toContain("PROXMOX_HOST=new-host");
    expect(envContent).not.toContain("PROXMOX_HOST=old-host");
    // Unrelated key should be preserved
    expect(envContent).toContain("DEVBOX_HOST=10.0.0.2");
  });

  it("appends a new key at the end", async () => {
    writeEnv("PROXMOX_HOST=192.168.1.10\n");

    await homelabSetup({
      action: "configure",
      updates: [{ key: "DEVBOX_HOST", value: "10.0.0.2" }],
    });

    const envContent = readEnv();
    expect(envContent).toContain("PROXMOX_HOST=192.168.1.10");
    expect(envContent).toContain("DEVBOX_HOST=10.0.0.2");
  });

  it("masks secret values in configure output", async () => {
    writeEnv("PROXMOX_HOST=192.168.1.10\n");

    const result = await homelabSetup({
      action: "configure",
      updates: [{ key: "RADARR_API_KEY", value: "my-secret-api-key" }],
    });

    expect(result).not.toContain("my-secret-api-key");
    expect(result).toContain("••••••••");
  });

  it("rejects unknown env var keys", async () => {
    const result = await homelabSetup({
      action: "configure",
      updates: [{ key: "MADE_UP_VAR", value: "test" }],
    });

    expect(result).toContain("Unknown env vars");
    expect(result).toContain("MADE_UP_VAR");
  });

  it("handles empty updates array gracefully", async () => {
    const result = await homelabSetup({
      action: "configure",
      updates: [],
    });

    expect(result).toContain("No updates provided");
  });

  it("preserves inline comments when updating existing keys", async () => {
    writeEnv("PROXMOX_HOST=old # the main host\n");

    await homelabSetup({
      action: "configure",
      updates: [{ key: "PROXMOX_HOST", value: "new-host" }],
    });

    const envContent = readEnv();
    expect(envContent).toContain("PROXMOX_HOST=new-host # the main host");
  });
});

describe("homelabSetup — test", () => {
  it("reports when no services are configured", async () => {
    const result = await homelabSetup({ action: "test", updates: [] });
    expect(result).toContain("No services configured yet");
  });
});

describe("SetupSchema — value validation", () => {
  it("rejects values containing newlines (.env injection)", () => {
    expect(() =>
      SetupSchema.parse({
        action: "configure",
        updates: [{ key: "PROXMOX_HOST", value: "1.2.3.4\nEVIL_KEY=oops" }],
      })
    ).toThrow();
  });

  it("accepts normal values", () => {
    expect(() =>
      SetupSchema.parse({
        action: "configure",
        updates: [{ key: "PROXMOX_HOST", value: "192.168.1.10" }],
      })
    ).not.toThrow();
  });
});
