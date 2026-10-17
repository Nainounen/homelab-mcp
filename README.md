# homelab-mcp

[![CI](https://github.com/Nainounen/homelab-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nainounen/homelab-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/homelab-mcp.svg)](https://www.npmjs.com/package/homelab-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node: >=20](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)

<br>

<img src="assets/banner.png" alt="homelab-mcp banner" width="800">

MCP server that gives AI assistants full control of a Proxmox homelab — manage VMs and containers, deploy Docker projects, monitor services, control the media stack, and check storage health, all from conversation.

Tools cover infrastructure, media automation, monitoring, storage, and network services. The modular architecture lets contributors add integrations without changing the MCP server core.

## AI Setup

**No manual config needed.** The server includes an AI-native setup wizard. Just connect it to your MCP client and say:

> "Set up my homelab" or "Configure the MCP server"

The setup wizard scans your configuration, guides you through each setting interactively, saves your answers, and verifies connectivity — all through conversation. Credentials are never exposed to the AI; the wizard masks passwords, API keys, and tokens before returning any results.

## Quick start

### Prerequisites
- **Node.js 20+**
- A Proxmox VE host reachable over the network
- A devbox (any SSH-accessible Linux host running Docker)
- (Optional) Media services: Plex, Radarr, Sonarr, SABnzbd, Overseerr, Prowlarr
- (Optional) Monitoring: Prometheus, Grafana, Uptime Kuma

### Install

**From npm (recommended):**
```bash
npm install -g homelab-mcp
# Or locally in your project:
npm install homelab-mcp
```

**From source (for contributors):**
```bash
git clone https://github.com/Nainounen/homelab-mcp.git
cd homelab-mcp
npm install
npm run build
```

### Docker (optional)

A Dockerfile is provided for containerized deployments:

```bash
npm run build
cp .env.example .env   # edit with your credentials
docker compose up -d
```

For most users, running directly with Node.js (no Docker) is simpler — the MCP server communicates over stdio.

### Connect to your MCP client

Add to your MCP client's config file. For Claude Code, that's `~/.claude/claude_mcp_config.json`:

```json
{
  "mcpServers": {
    "homelab": {
      "command": "npx",
      "args": ["homelab-mcp"],
      "cwd": "/path/to/your/homelab-config"
    }
  }
}
```

Place your `.env` file in the `cwd` directory (copy `.env.example` from this repo as a starting point). No secrets go in the MCP config — the server loads `.env` from its working directory.

Then just say **"set up my homelab"** — the AI-native setup wizard will guide you through the rest.

## Configuration

All settings live in `.env`. See `.env.example` for the full template. The server starts with the services you configure — any service whose env vars are missing is skipped with a warning.

### Required (server won't start without these)

| Variable | Description |
|---|---|
| `PROXMOX_HOST`, `PROXMOX_PORT`, `PROXMOX_USER`, `PROXMOX_NODE` | Proxmox API access |
| `PROXMOX_PASSWORD` or `PROXMOX_KEY_PATH` | Proxmox auth |
| `DEVBOX_HOST`, `DEVBOX_USER` | Devbox SSH access |
| `DEVBOX_PASSWORD` or `DEVBOX_KEY_PATH` | Devbox SSH auth |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr API |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr API |
| `PROWLARR_URL`, `PROWLARR_API_KEY` | Prowlarr API |
| `SABNZBD_URL`, `SABNZBD_API_KEY` | SABnzbd API |
| `OVERSEERR_URL`, `OVERSEERR_API_KEY` | Overseerr API |

### Optional (skipped with a warning if missing)

| Variable | Service |
|---|---|
| `QNAP_HOST`, `QNAP_USER`, `QNAP_PASSWORD` or `QNAP_KEY_PATH` | QNAP NAS |
| `PLEX_URL`, `PLEX_TOKEN` | Plex |
| `TAUTULLI_URL`, `TAUTULLI_API_KEY` | Tautulli analytics |
| `BAZARR_URL`, `BAZARR_API_KEY` | Bazarr subtitles |
| `ADGUARD_URL`, `ADGUARD_USER`, `ADGUARD_PASSWORD` | AdGuard Home |
| `PBS_URL`, `PBS_TOKEN_ID`, `PBS_TOKEN_SECRET` | Proxmox Backup Server |
| `LIDARR_URL`, `LIDARR_API_KEY` | Lidarr music |
| `READARR_URL`, `READARR_API_KEY` | Readarr books |
| `UPTIME_KUMA_URL`, `UPTIME_KUMA_USER`, `UPTIME_KUMA_PASSWORD` | Uptime Kuma |
| `PROMETHEUS_URL` | Prometheus API |
| `GRAFANA_URL`, `GRAFANA_TOKEN` | Grafana API |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram notifications |

### Security settings

| Variable | Default | Description |
|---|---|---|
| `SSH_STRICT_HOST_KEY` | `false` | Set to `true` to enable `known_hosts` verification |
| `PROXMOX_TLS_VERIFY` | `false` | Set to `true` to validate Proxmox TLS certificates |
| `PBS_TLS_VERIFY` | `false` | Set to `true` to validate PBS TLS certificates |

### Tuning

| Variable | Default | Description |
|---|---|---|
| `MAX_OUTPUT_CHARS` | `30000` | Max characters per tool result before truncation (`0` disables) |
| `HTTP_RETRIES` | `3` | Retries for transient HTTP failures (`0` disables) |
| `DEVBOX_CMD_TIMEOUT` | `30000` | Devbox SSH command timeout in ms |
| `PROXMOX_CMD_TIMEOUT` | `60000` | Proxmox SSH command timeout in ms |

## Tools reference

### Infrastructure

| Tool | Description |
|---|---|
| `proxmox_list_nodes` | List Proxmox nodes with CPU, RAM, uptime |
| `proxmox_list_vms` | List all VMs and LXC containers |
| `proxmox_start_vm` | Start a VM or container |
| `proxmox_stop_vm` | Stop a VM or container |
| `proxmox_restart_vm` | Restart a VM or container |
| `proxmox_get_metrics` | Detailed metrics for one VM/CT |
| `proxmox_get_node_metrics` | Node-level CPU, RAM, disk, load |
| `proxmox_create_ct` | Create a new Debian 12 LXC container |
| `proxmox_get_logs` | Tail task log for a VM/CT |
| `proxmox_exec` | Run a shell command on Proxmox host (dangerous commands blocked) |

### Devbox & Docker

| Tool | Description |
|---|---|
| `devbox_exec` | Run a shell command on the devbox (dangerous commands blocked) |
| `devbox_read_file` | Read a file (max 100 KB) |
| `devbox_write_file` | Write a file, auto-creates parent dirs (max 1 MB) |
| `devbox_list_dir` | List directory contents |
| `devbox_docker_ps` | Show running Docker containers |
| `devbox_docker_compose` | Run compose up/down/restart/pull/logs |
| `devbox_git` | Git status, pull, log, or clone a repo |
| `devbox_project_deploy` | Deploy: git pull → compose pull → compose up → status |
| `devbox_project_status` | Health check for a deployed project |
| `devbox_project_list` | Scan a base path for compose projects |

### Media — download & library

| Tool | Description |
|---|---|
| `radarr_search_movie` | Search for a movie by title |
| `radarr_add_movie` | Add a movie and trigger download search |
| `radarr_list_movies` | List movies with download status (filter/search/limit) |
| `radarr_remove_movie` | Remove a movie (optionally delete files) |
| `radarr_get_queue` | Active movie downloads with progress |
| `radarr_get_command` | Check the status of an asynchronous Radarr command |
| `radarr_force_search` | Re-search indexers for a movie |
| `radarr_get_history` | Recent download history |
| `radarr_check_releases` | Show available releases and rejections |
| `radarr_clear_queue` | Remove all items from download queue |
| `radarr_clear_blocklist` | Clear the release blocklist |
| `radarr_blocklist_release` | Blocklist a bad release and retry |
| `radarr_list_path_mappings` | List remote path mappings |
| `radarr_set_path_mapping` | Add/update a path mapping |
| `radarr_interactive_search` | Search releases with rejection reasons, languages, custom formats, and scores |
| `radarr_grab_release` | Grab one selected release by GUID and indexer ID |
| `radarr_manual_import` | Preview and import files from a specified folder |
| `radarr_list_custom_formats` | List custom formats and profile scores |
| `radarr_set_custom_format` | Create or update a custom format |
| `radarr_set_cf_score` | Set a custom format score on a quality profile |
| `radarr_get_quality_profile` | Inspect a profile and its guarded edit digest |
| `radarr_create_quality_profile` | Clone a profile template with selected quality and score settings |
| `radarr_edit_quality_profile` | Update a profile with digest protection |
| `radarr_delete_quality_profile` | Preview references before removing an unused profile |
| `radarr_bulk_set_quality_profile` | Assign a profile to a selected batch of movies |
| `radarr_remove_queue_item` | Dismiss one stale queue row without deleting the download |
| `radarr_remove_queue_items` | Preview and dismiss an explicit batch of queue rows |
| `radarr_blocklist_releases` | Preview and blocklist an explicit batch of tracked queue releases |
| `radarr_inspect_replacement` | Inspect a downloaded replacement candidate |
| `radarr_plan_downgrade` | Find smaller release candidates and report expected savings |
| `radarr_download_replacement` | Preview or download a selected smaller release |
| `radarr_import_replacement` | Preview or import a selected replacement file |
| `sonarr_search_series` | Search for a TV series by title |
| `sonarr_add_series` | Add a series and trigger download |
| `sonarr_list_series` | List series with episode progress (filter/search/limit) |
| `sonarr_remove_series` | Remove a series (optionally delete files) |
| `sonarr_get_queue` | Active episode downloads with progress |
| `sonarr_get_command` | Check the status of an asynchronous Sonarr command |
| `sonarr_force_search` | Re-search for missing episodes |
| `sonarr_season_search` | Search for a specific season |
| `sonarr_check_releases` | Show releases and rejections for a season |
| `sonarr_blocklist_release` | Blocklist and retry a failed download |
| `sonarr_clear_queue` | Clear the download queue |
| `sonarr_clear_blocklist` | Clear the release blocklist |
| `sonarr_list_path_mappings` | List remote path mappings |
| `sonarr_set_path_mapping` | Add/update a path mapping |
| `sonarr_interactive_search` | Search releases with rejection reasons, languages, custom formats, and scores |
| `sonarr_grab_release` | Grab one selected release by GUID and indexer ID |
| `sonarr_manual_import` | Preview and import files from a specified folder |
| `sonarr_list_custom_formats` | List custom formats and profile scores |
| `sonarr_set_custom_format` | Create or update a custom format |
| `sonarr_set_cf_score` | Set a custom format score on a quality profile |
| `sonarr_get_quality_profile` | Inspect a profile and its guarded edit digest |
| `sonarr_create_quality_profile` | Clone a profile template with selected quality and score settings |
| `sonarr_edit_quality_profile` | Update a profile with digest protection |
| `sonarr_delete_quality_profile` | Preview references before removing an unused profile |
| `sonarr_remove_queue_item` | Dismiss one stale queue row without deleting the download |
| `sonarr_remove_queue_items` | Preview and dismiss an explicit batch of queue rows |
| `sonarr_blocklist_releases` | Preview and blocklist an explicit batch of tracked queue releases |
| `sabnzbd_get_status` | Download speed, ETA, disk space, queue size |
| `sabnzbd_list_queue` | Active NZB downloads with progress |
| `sabnzbd_get_history` | Recent download history |
| `sabnzbd_get_warnings` | Read active SABnzbd warnings and errors |
| `sabnzbd_get_job` | Inspect a specific NZO ID in the queue or history, including failures and post-processing |
| `sabnzbd_pause_queue` | Pause downloads |
| `sabnzbd_resume_queue` | Resume downloads |
| `sabnzbd_delete_item` | Delete a queue item by NZO ID |
| `sabnzbd_delete_queue_items` | Preview and delete selected queue jobs by NZO ID and expected name |
| `sabnzbd_delete_history` | Preview and permanently delete selected terminal history entries |
| `prowlarr_list_indexers` | List indexers with status |
| `prowlarr_sync_apps` | Sync indexers to Radarr/Sonarr |
| `prowlarr_test_indexers` | Test all (or one) indexer |
| `lidarr_search_artist` | Search for a music artist |
| `lidarr_add_artist` | Add an artist to Lidarr |
| `lidarr_list_artists` | List all artists with album counts |
| `lidarr_remove_artist` | Remove an artist |
| `lidarr_get_queue` | Active music downloads |
| `readarr_search_book` | Search for a book |
| `readarr_add_book` | Add a book to Readarr |
| `readarr_list_books` | List all books |
| `readarr_get_queue` | Active book downloads |

Bulk queue and history tools accept 1 to 200 explicit items. SABnzbd selections support both legacy `SABnzbd_nzo_` IDs and UUID IDs; broad selectors such as `all` and `failed` are rejected. Preview first, then pass the returned `batch_digest` as `expected_batch_digest` with `preview_only: false`. The restricted media server requests one native human approval for that batch and rechecks it before applying. Files and replacement searches are preserved or disabled by default. Sonarr and Radarr batches must include every queue row sharing a selected download ID; blocklisting requires a currently tracked release. SABnzbd history deletion skips Archive and accepts only Completed or Failed entries. Results report whether each row disappeared; this does not establish media availability or confirm file deletion. After an uncertain write, inspect current state before retrying.

### Media — Plex & requests

| Tool | Description |
|---|---|
| `plex_get_metadata` | Inspect one movie or show's current metadata identity and files |
| `plex_get_matches` | Find candidate metadata matches for one movie or show |
| `plex_fix_match` | Preview and approve a guarded metadata rematch |
| `plex_get_libraries` | List Plex libraries with item counts |
| `plex_list_shares` | List pending and accepted library shares |
| `plex_invite_user` | Preview an invitation to selected libraries |
| `plex_search` | Search across all libraries |
| `plex_get_sessions` | Who is streaming, what, transcode/direct play |
| `plex_recently_added` | Recently added movies and episodes |
| `plex_refresh_library` | Trigger a library scan |
| `plex_delete_media` | Permanently delete by ratingKey |
| `plex_get_watch_history` | Recent watch history across users |
| `seerr_list_requests` | List media requests from family |
| `seerr_get_request` | Inspect request status, availability, seasons, and linked Arr IDs |
| `seerr_retry_request` | Preview or retry a failed request |
| `seerr_get_quality_profile_settings` | Inspect linked Arr servers and Seerr default profiles |
| `seerr_set_quality_profile` | Change the quality profile used for future requests |
| `seerr_approve_request` | Approve a pending request |
| `seerr_decline_request` | Decline a request |
| `seerr_delete_request` | Delete a request |
| `seerr_stats` | Request statistics |
| `tautulli_get_activity` | Current Plex streams (Tautulli) |
| `tautulli_get_history` | Plex watch history (Tautulli) |
| `tautulli_get_stats` | 30-day play stats |
| `bazarr_status` | Wanted subtitle counts |
| `bazarr_download_subtitle` | Preview or download a subtitle for one movie or episode |
| `bazarr_search_wanted_movies` | Start Bazarr's wanted movie search after preview |
| `bazarr_search_wanted_episodes` | Start Bazarr's wanted episode search after preview |
| `bazarr_get_settings` | Inspect settings with secrets redacted |
| `bazarr_update_settings` | Preview and patch selected settings |
| `bazarr_set_enabled_languages` | Preview and replace enabled subtitle languages |
| `bazarr_set_language_profiles` | Preview and replace the language profile list |
| `bazarr_get_system_health` | Inspect Bazarr health |
| `bazarr_get_system_tasks` | Inspect scheduled system tasks |
| `bazarr_get_system_jobs` | Inspect background job progress |
| `bazarr_get_providers` | Inspect subtitle provider configuration and status |
| `bazarr_get_movies_wanted` | List movies missing subtitles |
| `bazarr_get_episodes_wanted` | List episodes missing subtitles |

Bazarr also exposes tools generated from its API schema for subtitle history, blacklist, files, providers, languages, backups, logs, and system tasks. Write operations preview by default. For write tools that return an `expected_hash`, pass that value back to apply the change against the state you reviewed.

### Media — operational

| Tool | Description |
|---|---|
| `media_status` | Running container status and uptime |
| `media_logs` | Tail logs for a media container |
| `media_restart` | Restart a media container |
| `media_dashboard` | All-in-one: Proxmox, containers, downloads, library, storage, GPU |
| `nvidia_status` | GPU temp, util, VRAM, power |
| `security_status` | SSH config and Proxmox firewall status |

### Monitoring & observability

| Tool | Description |
|---|---|
| `prometheus_snapshot` | Quick CPU, RAM, disk, network, container health |
| `prometheus_query` | Run an arbitrary PromQL query |
| `prometheus_range_query` | Historical metric trends |
| `grafana_list_dashboards` | List all dashboards |
| `grafana_get_dashboard` | Get panel list for a dashboard |
| `grafana_query_panel` | Query actual data from a panel |
| `uptime_status` | Monitor up/down status and latency |

### Storage, network & DNS

| Tool | Description |
|---|---|
| `qnap_status` | QNAP NAS: RAID, drive temps, storage |
| `qnap_disk_health` | SMART health per drive |
| `qnap_storage_usage` | Per-share usage and LVM |
| `qnap_raid_status` | RAID array health check |
| `pbs_status` | PBS datastore usage |
| `pbs_list_snapshots` | Recent backup snapshots |
| `pbs_get_tasks` | Backup/verify/GC task history |
| `adguard_stats` | DNS query stats and block rate |
| `adguard_check_host` | Check if a domain is blocked |
| `adguard_toggle_protection` | Enable/disable DNS filtering |
| `wol_send` | Wake-on-LAN magic packet |
| `tailscale_status` | Tailscale peers and status |

### Updates, notifications & meta

| Tool | Description |
|---|---|
| `container_check_updates` | Check for newer Docker images |
| `container_update` | Pull + restart a container |
| `notify_telegram` | Send a message to Telegram |
| `homelab_health` | Ping all configured services, report reachable/down + latency |
| `homelab_capabilities` | **Start here** — lists all available tools |
| `homelab_setup` | **AI-guided setup wizard** — configure `.env` through conversation |

## Architecture

```
src/
├── {service}.ts          # Layer 1: HTTP/SSH client factory
├── tools/{service}.ts    # Layer 2: Zod schemas + implementations
├── modules/{service}.ts  # Layer 3: Tool definitions + handler router
├── modules/registry.ts   # Central module registry
└── index.ts              # MCP server entry point
```

Each integration follows the same three-file pattern. Adding a new service means creating these three files and registering it in the registry. The scaffolding script handles the boilerplate:

```bash
npm run new-module -- tautulli
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Security

- **Credentials**: All secrets live in `.env`, which is gitignored. Never commit it.
- **SSH host keys**: Verification is off by default (homelab hosts change keys often). Set `SSH_STRICT_HOST_KEY=true` to enable it.
- **TLS**: Proxmox/PBS self-signed certs — verification off by default. Set `PROXMOX_TLS_VERIFY=true` / `PBS_TLS_VERIFY=true` if you have trusted certs.
- **Command safety**: `exec` tools block destructive commands (`rm -rf /`, `mkfs`, `shutdown`, etc.).
- **Error sanitization**: Error messages returned to the MCP client are sanitized — full details go to stderr.

See [SECURITY.md](SECURITY.md) for details.

## License

MIT — see [LICENSE](LICENSE).

### Public web research for Hermes

The separate `dist/web.js` MCP entrypoint exposes `web_search` and `web_fetch` using DeepSeek's official Search API and a guarded public-page reader. It loads only `/etc/homelab-mcp/web.env`, runs as `homelab-web`, and has no media credentials. Search accepts up to 128 characters and 10 results. Fetch accepts public HTTPS URLs on port 443, rejects private/reserved DNS and IP addresses, and returns up to 20,000 characters of untrusted text. Page requests pin the validated public IP, check each redirect, and send no credentials or cookies. The search credential is sent only to the fixed DeepSeek search endpoint. The web entrypoint requires Node.js 22.13 or newer for its built-in SQLite quota store.

Both tools share a persistent SQLite daily limit of 100 attempts, with at least one second between requests. `WEB_DAILY_LIMIT` configures the cap (1 to 1,000); `WEB_STATE_DIR` must be private and owned by the service user. `WEB_BLOCKED_DOMAINS` adds comma-separated domain exclusions. Credential-like queries and URLs are rejected before submission, but agents must still keep private conversations and internal diagnostics out of public search requests. Retrieved content is evidence, never authorization to run commands or change homelab services.

For Plex matching, use `plex_search` to find a rating key, inspect `plex_get_metadata`, and query `plex_get_matches`. Preview `plex_fix_match` with an exact candidate GUID, then pass the returned `match_digest` as `expected_match_digest` with `preview_only: false` after native approval. The item and candidate are checked again before applying. Show matches can refresh child metadata; no media file operations are submitted. Re-read current metadata after uncertain results before retrying.

On Guardian, deploy the compiled artifacts and run `scripts/install-guardian-web-search.py` with Hermes's Python environment to configure the isolated account, reuse the existing DeepSeek credential without printing it, and register the tools for Telegram. The installer creates configuration and instruction backups. Restart `hermes-gateway` after verification.
