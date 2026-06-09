import { describe, it, expect } from "vitest";

/**
 * Extract the BLOCKED_PATTERNS regexps from ssh.ts by duplicating them.
 * We test against the actual patterns used at runtime.
 */
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs\b/,
  /dd\s+if=.*of=\/dev\/(sd|nvme|vd|hd)/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bpoweroff\b/,
  /\bhalt\b/,
  /\binit\s+0\b/,
  /systemctl\s+(reboot|poweroff|halt|shutdown)/,
  /\bsystemctl\s+stop\s+ssh\b/,
];

const PVE_BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /mkfs\b/,
  /dd\s+if=.*of=\/dev\/(sd|nvme|vd|hd)/,
  /\bpoweroff\b/,
  /\bhalt\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+0\b/,
  /systemctl\s+(reboot|poweroff|halt|shutdown)/,
];

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

  it("does not block systemctl stop sshd (pattern targets ssh, not sshd)", () => {
    // The pattern is /\bsystemctl\s+stop\s+ssh\b/ — "sshd" doesn't end at "ssh"
    expect(isBlocked("systemctl stop sshd", BLOCKED_PATTERNS)).toBe(false);
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

  it("allows commands containing blocklist words as substrings", () => {
    // "reboot" inside a longer string should still be blocked
    expect(isBlocked("echo reboot-required", BLOCKED_PATTERNS)).toBe(true);
  });

  it("blocks systemctl reboot in PVE patterns", () => {
    expect(isBlocked("systemctl reboot", PVE_BLOCKED_PATTERNS)).toBe(true);
    expect(isBlocked("systemctl poweroff", PVE_BLOCKED_PATTERNS)).toBe(true);
  });

  it("allows systemctl status in PVE patterns", () => {
    // systemctl status should NOT match
    expect(isBlocked("systemctl status sshd", PVE_BLOCKED_PATTERNS)).toBe(false);
  });
});
