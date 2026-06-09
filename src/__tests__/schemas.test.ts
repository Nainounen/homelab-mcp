import { describe, it, expect } from "vitest";
import { z } from "zod";

// Re-import the schemas from the actual source files
import { VmActionSchema, CreateCtSchema, GetLogsSchema, PveExecSchema } from "../tools/proxmox.js";
import { ExecSchema, WriteFileSchema, DockerComposeSchema } from "../tools/devbox.js";
import { RadarrAddMovieSchema, RadarrRemoveMovieSchema } from "../tools/radarr.js";

describe("VmActionSchema", () => {
  it("accepts valid qemu input", () => {
    expect(() => VmActionSchema.parse({ vmid: 100, type: "qemu" })).not.toThrow();
  });

  it("accepts valid lxc input", () => {
    expect(() => VmActionSchema.parse({ vmid: 200, type: "lxc" })).not.toThrow();
  });

  it("rejects invalid type", () => {
    expect(() => VmActionSchema.parse({ vmid: 100, type: "docker" })).toThrow(z.ZodError);
  });

  it("rejects negative vmid", () => {
    expect(() => VmActionSchema.parse({ vmid: -1, type: "qemu" })).toThrow(z.ZodError);
  });

  it("rejects missing vmid", () => {
    expect(() => VmActionSchema.parse({ type: "qemu" })).toThrow(z.ZodError);
  });
});

describe("CreateCtSchema", () => {
  const validInput = {
    hostname: "test-ct",
    cores: 2,
    memory: 2048,
    disk: 20,
    ip: "192.168.1.100",
    password: "securepassword",
  };

  it("accepts valid input", () => {
    expect(() => CreateCtSchema.parse(validInput)).not.toThrow();
  });

  it("rejects zero cores", () => {
    expect(() => CreateCtSchema.parse({ ...validInput, cores: 0 })).toThrow(z.ZodError);
  });

  it("rejects very small memory", () => {
    expect(() => CreateCtSchema.parse({ ...validInput, memory: 32 })).toThrow(z.ZodError);
  });

  it("rejects missing hostname", () => {
    // zod .string() allows empty string by default — the API would reject it.
    // We test that the field is still required (missing key throws).
    const { hostname, ...rest } = validInput;
    expect(() => CreateCtSchema.parse(rest)).toThrow(z.ZodError);
  });
});

describe("GetLogsSchema", () => {
  it("defaults lines to 100", () => {
    const result = GetLogsSchema.parse({ vmid: 100, type: "lxc" });
    expect(result.lines).toBe(100);
  });

  it("rejects lines > 5000", () => {
    expect(() => GetLogsSchema.parse({ vmid: 100, type: "lxc", lines: 6000 })).toThrow(z.ZodError);
  });
});

describe("WriteFileSchema", () => {
  it("accepts valid input", () => {
    expect(() =>
      WriteFileSchema.parse({ path: "/tmp/test.txt", content: "hello" })
    ).not.toThrow();
  });

  it("rejects content exceeding 1 MB", () => {
    const oneMBPlusOne = "x".repeat(1_048_577);
    expect(() =>
      WriteFileSchema.parse({ path: "/tmp/test.txt", content: oneMBPlusOne })
    ).toThrow(z.ZodError);
  });

  it("accepts content at exactly 1 MB", () => {
    const oneMB = "x".repeat(1_048_576);
    expect(() =>
      WriteFileSchema.parse({ path: "/tmp/test.txt", content: oneMB })
    ).not.toThrow();
  });
});

describe("DockerComposeSchema", () => {
  it("accepts valid actions", () => {
    for (const action of ["up", "down", "restart", "pull", "logs"]) {
      expect(() =>
        DockerComposeSchema.parse({ action, project_dir: "/opt/test" })
      ).not.toThrow();
    }
  });

  it("rejects invalid action", () => {
    expect(() =>
      DockerComposeSchema.parse({ action: "delete", project_dir: "/opt/test" })
    ).toThrow(z.ZodError);
  });

  it("accepts optional service", () => {
    expect(() =>
      DockerComposeSchema.parse({ action: "up", project_dir: "/opt/test", service: "web" })
    ).not.toThrow();
  });
});

describe("RadarrAddMovieSchema", () => {
  it("accepts tmdb_id", () => {
    expect(() => RadarrAddMovieSchema.parse({ tmdb_id: 12345 })).not.toThrow();
  });

  it("accepts title for lookup", () => {
    expect(() => RadarrAddMovieSchema.parse({ title: "Inception" })).not.toThrow();
  });

  it("accepts quality profile override", () => {
    expect(() =>
      RadarrAddMovieSchema.parse({ tmdb_id: 12345, quality_profile: "HD-1080p" })
    ).not.toThrow();
  });
});

describe("RadarrRemoveMovieSchema", () => {
  it("defaults delete_files to false", () => {
    const result = RadarrRemoveMovieSchema.parse({ tmdb_id: 12345 });
    expect(result.delete_files).toBe(false);
  });

  it("accepts explicit delete_files true", () => {
    const result = RadarrRemoveMovieSchema.parse({ tmdb_id: 12345, delete_files: true });
    expect(result.delete_files).toBe(true);
  });
});
