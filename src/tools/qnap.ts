import { QnapSSH } from "../qnap.js";

function bytes(n: number): string {
  if (n >= 1_099_511_627_776) return `${(n / 1_099_511_627_776).toFixed(1)} TB`;
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${n} B`;
}

function storageShares(): string {
  return process.env.QNAP_STORAGE_SHARES ?? "/share/media /share/backups /share/vmstore";
}

function driveDevices(): string {
  return process.env.QNAP_DRIVE_DEVICES ?? "/dev/sda /dev/sdb";
}

export async function qnapStatus(ssh: QnapSSH): Promise<string> {
  const [raid, storage, temps] = await Promise.all([
    ssh.exec("cat /proc/mdstat | grep -A2 'md1'"),
    ssh.exec(`df -h ${storageShares()} 2>/dev/null | tail -n +2`),
    ssh.exec(
      `for d in ${driveDevices()}; do echo -n "$d: "; smartctl -A $d 2>/dev/null | grep -i 'Temperature_Celsius' | awk '{print $10"°C"}'; done`
    ),
  ]);

  const lines: string[] = ["QNAP NAS\n"];

  // RAID status
  const raidOut = raid.stdout.trim();
  const raidStatus = raidOut.includes("[UU]") ? "✓ RAID 1 healthy (both drives)" : raidOut.includes("[U_]") || raidOut.includes("[_U]") ? "⚠ RAID degraded — one drive missing!" : raidOut || "unknown";
  lines.push(`RAID: ${raidStatus}`);

  // Drive temps
  if (temps.stdout.trim()) {
    lines.push(`Drives: ${temps.stdout.trim().replace(/\n/g, " | ")}`);
  }

  // Storage usage
  if (storage.stdout.trim()) {
    lines.push("\nShares:");
    storage.stdout.trim().split("\n").forEach(l => lines.push(`  ${l}`));
  }

  return lines.join("\n");
}

export async function qnapDiskHealth(ssh: QnapSSH): Promise<string> {
  const result = await ssh.exec(`
    for d in ${driveDevices()}; do
      echo "=== $d ==="
      smartctl -H $d 2>/dev/null | grep -E 'overall|PASSED|FAILED'
      smartctl -A $d 2>/dev/null | grep -E 'Reallocated|Pending|Uncorrectable|Temperature' | awk '{print $2": "$10}'
    done
  `);
  return result.stdout || "Could not read SMART data";
}

export async function qnapStorageUsage(ssh: QnapSSH): Promise<string> {
  const result = await ssh.exec(`df -h ${storageShares()} 2>/dev/null && echo '---' && pvs && vgs`);
  return result.stdout || result.stderr;
}

export async function qnapRaidStatus(ssh: QnapSSH): Promise<string> {
  const result = await ssh.exec("cat /proc/mdstat");
  const out = result.stdout;
  if (out.includes("[UU]")) return "✓ RAID 1 fully healthy — both drives synced";
  if (out.includes("[U_]") || out.includes("[_U]")) return "⚠ WARNING: RAID degraded — one drive has failed!";
  if (out.includes("resync")) return "↻ RAID is currently syncing...";
  return out || "Unknown RAID state";
}
