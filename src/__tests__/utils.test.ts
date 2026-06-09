import { describe, it, expect } from "vitest";
import { bytes, speed } from "../utils.js";

describe("bytes", () => {
  it("formats bytes", () => {
    expect(bytes(500)).toBe("500 B");
  });

  it("formats megabytes", () => {
    expect(bytes(1_048_576)).toBe("1.0 MB");
    expect(bytes(2_097_152)).toBe("2.0 MB");
  });

  it("formats gigabytes", () => {
    expect(bytes(1_073_741_824)).toBe("1.0 GB");
    expect(bytes(5_368_709_120)).toBe("5.0 GB");
  });

  it("handles zero", () => {
    expect(bytes(0)).toBe("0 B");
  });

  it("handles edge cases", () => {
    expect(bytes(1_048_575)).toBe("1048575 B");
    expect(bytes(1_048_577)).toBe("1.0 MB");
  });
});

describe("speed", () => {
  it("formats zero speed", () => {
    expect(speed(0)).toBe("0 KB/s");
  });

  it("formats KB/s", () => {
    expect(speed(1024)).toBe("1 KB/s");
    expect(speed(2048)).toBe("2 KB/s");
    // 1047552 / 1024 = 1023.0 exactly
    expect(speed(1_047_552)).toBe("1023 KB/s");
  });

  it("formats MB/s", () => {
    expect(speed(1_048_576)).toBe("1.0 MB/s");
    expect(speed(5_242_880)).toBe("5.0 MB/s");
  });

  it("handles small values", () => {
    expect(speed(1)).toBe("0 KB/s");
  });
});
