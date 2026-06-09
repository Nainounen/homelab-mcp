#!/usr/bin/env python3
"""
Media services health checker for homelab-mcp media_dashboard.

Reads the media stack's .env for API keys and queries SABnzbd, Prowlarr,
and Overseerr via their local HTTP APIs. Prints a JSON result to stdout.

Configurable via environment variables on the devbox:
  MEDIA_ENV_PATH      — path to the media stack .env file (default: /opt/media/.env)
  SABNZBD_CONFIG_PATH — path to sabnzbd.ini for API key extraction
  SABNZBD_PORT        — SABnzbd port (default: 8085)
  PROWLARR_PORT       — Prowlarr port (default: 9696)
  OVERSEERR_PORT      — Overseerr port (default: 5055)
"""

import json
import os
import urllib.request
from pathlib import Path


def load_env(path: str) -> dict:
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def fetch(url: str, api_key: str | None = None):
    headers = {"X-Api-Key": api_key} if api_key else {}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


def main() -> None:
    result: dict = {}

    media_env = os.environ.get("MEDIA_ENV_PATH", "/opt/media/.env")
    env = load_env(media_env)

    # ── SABnzbd ──────────────────────────────────────────────────────────
    sab_config = os.environ.get("SABNZBD_CONFIG_PATH", "/opt/media/config/sabnzbd/sabnzbd.ini")
    sab_port = os.environ.get("SABNZBD_PORT", "8085")
    try:
        sab_ini = Path(sab_config).read_text().splitlines()
        sab_key = next(
            line.split(" = ", 1)[1].strip()
            for line in sab_ini
            if line.startswith("api_key = ")
        )
        sab_queue = fetch(
            f"http://127.0.0.1:{sab_port}/api?mode=queue&output=json&apikey={sab_key}"
        )
        q = sab_queue.get("queue", {})
        result["sab"] = {
            "status": q.get("status", "unknown"),
            "speed": float(q.get("kbpersec", 0) or 0),
            "jobs": int(q.get("noofslots", 0) or 0),
            "sizeleft": q.get("sizeleft", "0 B"),
        }
    except Exception as exc:
        result["sab_error"] = str(exc)

    # ── Prowlarr ─────────────────────────────────────────────────────────
    prowlarr_port = os.environ.get("PROWLARR_PORT", "9696")
    try:
        prowlarr_key = env.get("PROWLARR_API_KEY")
        if prowlarr_key:
            health = fetch(
                f"http://127.0.0.1:{prowlarr_port}/api/v1/health", prowlarr_key
            )
            indexers = fetch(
                f"http://127.0.0.1:{prowlarr_port}/api/v1/indexer", prowlarr_key
            )
            result["prowlarr"] = {
                "enabled_indexers": sum(1 for i in indexers if i.get("enable")),
                "health_warnings": len(health),
            }
    except Exception as exc:
        result["prowlarr_error"] = str(exc)

    # ── Overseerr ────────────────────────────────────────────────────────
    overseerr_port = os.environ.get("OVERSEERR_PORT", "5055")
    try:
        overseerr_key = env.get("OVERSEERR_API_KEY")
        if overseerr_key:
            status = fetch(
                f"http://127.0.0.1:{overseerr_port}/api/v1/status", overseerr_key
            )
            counts = fetch(
                f"http://127.0.0.1:{overseerr_port}/api/v1/request/count",
                overseerr_key,
            )
            result["seerr"] = {
                "version": status.get("version"),
                "pending": counts.get("pending"),
                "processing": counts.get("processing"),
                "approved": counts.get("approved"),
                "available": counts.get("available"),
            }
    except Exception as exc:
        result["seerr_error"] = str(exc)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
