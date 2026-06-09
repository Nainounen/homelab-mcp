import { ArrClient } from "./arr.js";

export function bytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${n} B`;
}

export function speed(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} KB/s`;
  return "0 KB/s";
}

export interface QualityProfile {
  id: number;
  name: string;
}

export async function getFirstQualityProfileId(client: ArrClient, appName: string): Promise<number> {
  const profiles = await client.get<QualityProfile[]>("/qualityprofile");
  if (!profiles.length) throw new Error(`No quality profiles found in ${appName}`);
  const any = profiles.find((p) => p.name.toLowerCase() === "any");
  return (any ?? profiles[0]).id;
}
