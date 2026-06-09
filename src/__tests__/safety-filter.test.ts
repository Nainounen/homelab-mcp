import { describe, it, expect } from "vitest";
import { BLOCKED_PATTERNS, PVE_BLOCKED_PATTERNS } from "../ssh.js";

function isBlocked(command: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(command));
}

describe("devbox safety filter (BLOCKED_PATTERNS)", () => {
  it("blocks rm -rf /", () => {
    expect(isBlocked("rm -rf /", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("rm -rf / --no-preserve-root", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks mkfs", () => {
    expect(isBlocked("mkfs.ext4 /dev/sda1", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks dd to block devices", () => {
    expect(isBlocked("dd if=/dev/zero of=/dev/sda", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("dd if=image of=/dev/nvme0n1", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks shutdown/reboot/poweroff/halt", () => {
    expect(isBlocked("shutdown -h now", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("reboot", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("poweroff", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("halt", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("init 0", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl stop ssh", () => {
    expect(isBlocked("systemctl stop ssh", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl stop sshd (now covered by expanded pattern)", () => {
    expect(isBlocked("systemctl stop sshd", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl stop ssh.service", () => {
    expect(isBlocked("systemctl stop ssh.service", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl stop ssh.socket", () => {
    expect(isBlocked("systemctl stop ssh.socket", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl shutdown variants", () => {
    expect(isBlocked("systemctl reboot", BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("systemctl poweroff", BLOCKED_PATTERNS)).toBe(true);
  });

  it("allows safe commands", () => {
    expect(isBlocked("ls -la", BLOCKED_PATTERNS)).toBe(false);
    expect(isBlocked("docker ps", BLOCKED_PATTERNS)).toBe(false);
    expect(isBlocked("git status", BLOCKED_PATTERNS)).toBe(false);
    expect(isBlocked("echo hello", BLOCKED_PATTERNS)).toBe(false);
    expect(isBlocked("cat /etc/hostname", BLOCKED_PATTERNS)).toBe(false);
  });

  it("blocks commands containing blocklist words as substrings", () => {
    expect(isBlocked("echo reboot-required", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl reboot in PVE patterns", () => {
    expect(isBlocked("systemctl reboot", PVE_BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("systemctl poweroff", PVE_BLOCKED_PATTERNS)).toBe(true);
  });

  it("allows systemctl status in PVE patterns", () => {
    expect(isBlocked("systemctl status sshd", PVE_BLOCKED_PATTERNS)).toBe(false);
  });
});
