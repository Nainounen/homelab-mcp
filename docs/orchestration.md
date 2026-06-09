# Homelab Orchestration with homelab-mcp

How to compose the 65+ MCP tools into real workflows — deploying projects, managing media, monitoring health, and troubleshooting issues, all through conversation with an AI assistant.

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Infrastructure Orchestration](#infrastructure-orchestration)
3. [Media Stack Management](#media-stack-management)
4. [Monitoring & Alerting](#monitoring--alerting)
5. [Storage & Backup](#storage--backup)
6. [Network & DNS](#network--dns)
7. [Security Auditing](#security-auditing)
8. [Automation Patterns](#automation-patterns)
9. [Troubleshooting Recipes](#troubleshooting-recipes)

---

## Quick Reference

### Tool Naming Convention

```
{service}_{action}
```

Examples: `proxmox_list_vms`, `radarr_add_movie`, `devbox_docker_compose`

### Always Start Here

1. **`homelab_capabilities`** — discover what's available
2. **`media_dashboard`** — one-call overview of your entire homelab
3. **`homelab_health`** — ping check on all configured services

### Safety Rules

| Rule | Mechanism |
|------|-----------|
| Credentials never reach the AI | Setup wizard masks all `PASSWORD`, `API_KEY`, `TOKEN`, `SECRET` values |
| Destructive shell commands blocked | `rm -rf /`, `mkfs`, `dd`, `shutdown`, `reboot` are regex-blocked |
| Path traversal prevented | `..` in file paths is rejected by Zod validation |
| Write limits enforced | File writes capped at 1 MB, reads at 100 KB |
| Error messages sanitized | URLs, API keys, and tokens redacted before reaching the AI |

---

## Infrastructure Orchestration

### Deploying a New Docker Project

The `devbox_project_deploy` tool handles the full deployment dance in one call — git pull, compose pull, compose up, status check:

```
1. devbox_git with action:"clone" — clone the repo to /opt/projects/my-app
2. devbox_project_deploy with project_dir:"/opt/projects/my-app"
   → git pull → docker compose pull → docker compose up -d → docker compose ps
```

After deployment, use `devbox_project_status` for ongoing health checks (container status + recent logs).

### Creating a New LXC Container

```
proxmox_create_ct with hostname, cores, memory, disk, ip, password
→ Proxmox assigns next available CTID automatically
→ 30-second rate limit prevents accidental mass creation
```

Then verify with `proxmox_list_vms` or `proxmox_get_metrics`.

### Checking What's Running

```
media_dashboard
→ Proxmox node health, storage usage, all containers, active downloads,
  library stats, GPU status, media service health — in one call
```

### Rolling Updates

```
1. container_check_updates — see which containers have newer images
2. container_update with container:"plex" — pull + restart a single container
   (or use project_dir for compose-based services)
```

---

## Media Stack Management

### Adding Content

**Movie:**
```
1. radarr_search_movie with title:"Dune: Part Two"
   → returns tmdbId, year, overview, IMDb rating
2. radarr_add_movie with tmdb_id:<id>
   → adds to library, triggers automatic download search
3. radarr_get_queue — monitor download progress
```

**TV Series:**
```
1. sonarr_search_series with title:"Severance"
   → returns tvdbId, overview, network
2. sonarr_add_series with tvdb_id:<id>, monitor:"all"
   → adds series, monitors all episodes, triggers search
3. sonarr_get_queue — monitor downloads
```

**Music / Books:**
```
lidarr_search_artist → lidarr_add_artist → lidarr_get_queue
readarr_search_book → readarr_add_book → readarr_get_queue
```

### Handling Download Issues

When a download gets stuck or fails:

```
1. radarr_get_queue — find the stuck item (note its queueId)
2. radarr_check_releases with tmdb_id — see grabbable vs rejected releases
   → rejected section shows WHY each release was rejected
3. radarr_blocklist_release with queue_id:<id> — blocklist the bad release
   → optionally triggers a fresh search automatically
```

Mass cleanup:
```
radarr_clear_queue — remove all items and cancel in SABnzbd
radarr_clear_blocklist — reset all blocklisted releases
sonarr_clear_queue / sonarr_clear_blocklist — same for TV
```

### Managing Plex

```
plex_get_sessions — who's streaming, what, transcode/direct play
plex_recently_added — what's new (limit: 20)
plex_get_watch_history — recent plays across all users
plex_refresh_library with library_name:"Movies" — scan for new files
plex_delete_media with rating_key — permanently delete (use with caution)
```

### Handling Family Requests (Overseerr/Seerr)

```
1. seerr_list_requests with filter:"pending" — see what's been requested
2. seerr_approve_request with request_id — approve (triggers Radarr/Sonarr add)
3. seerr_stats — overall request metrics
```

### Path Mappings (Remote Download Clients)

When Radarr/Sonarr can't find downloaded files because paths differ between the download client and the *arr container:

```
1. radarr_list_path_mappings — see current mappings
2. radarr_set_path_mapping with host, remote_path, local_path — add/update
```

Same for Sonarr: `sonarr_list_path_mappings` / `sonarr_set_path_mapping`.

---

## Monitoring & Alerting

### Real-Time Metrics

**Quick snapshot:**
```
prometheus_snapshot
→ CPU%, RAM, disk usage, network throughput, container count, scrape health
```

**Ad-hoc queries:**
```
prometheus_query with query:"rate(container_cpu_usage_seconds_total[5m])"
prometheus_range_query with query:"node_memory_MemAvailable_bytes", duration:"24h"
```

**Grafana dashboards:**
```
1. grafana_list_dashboards — find dashboard UIDs
2. grafana_get_dashboard with uid — list panels
3. grafana_query_panel with uid, panel_id — get actual data
```

### Uptime Monitoring

```
uptime_status
→ all Uptime Kuma monitors, up/down status, latency
→ down services listed first
```

### Sending Alerts

```
notify_telegram with message:"⚠️ homelab alert: Plex container is down"
```

Use for:
- Confirming destructive operations completed
- Reporting health check failures
- Notifying about completed deployments

### Health Check Workflow

```
1. homelab_health — ping all configured services (results cached 30s)
   → ✓ reachable with latency, ✗ unreachable with error reason
2. For each unreachable service:
   - media_logs with container:"<name>" — check recent logs
   - media_restart with container:"<name>" — try restarting
   - devbox_docker_ps — verify container status
3. notify_telegram if the issue requires manual intervention
```

---

## Storage & Backup

### QNAP NAS Health

```
1. qnap_status — RAID health, drive temps, storage per share
2. qnap_disk_health — SMART data for every drive
3. qnap_raid_status — confirm array is healthy and synced
```

### Proxmox Backup Server

```
1. pbs_status — datastore usage
2. pbs_list_snapshots — recent backup snapshots
3. pbs_get_tasks — backup/verify/GC task history
```

### Disk Space Check

```
media_dashboard → STORAGE section shows df -h for all DASHBOARD_DISK_PATHS
```

Or ad-hoc:
```
devbox_exec with command:"df -h /mnt/data"
```

---

## Network & DNS

### Wake-on-LAN

```
wol_send with mac:"AA:BB:CC:DD:EE:FF"
→ sends magic packet (requires wakeonlan on the devbox)
```

### Tailscale VPN

```
tailscale_status
→ connected peers, IPs, which devices are online
```

### AdGuard DNS

```
1. adguard_stats — query count, blocked count, block rate, top domains
2. adguard_check_host with host:"ads.example.com" — is this blocked?
3. adguard_toggle_protection with enable:false — temporarily disable filtering
```

---

## Security Auditing

### Regular Security Check

```
security_status
→ SSH config review (PasswordAuthentication, PermitRootLogin, etc.)
→ Proxmox firewall status
```

### GPU Status

```
nvidia_status
→ GPU name, temperature, utilization %, VRAM usage, power draw
```

---

## Automation Patterns

### Deploy-and-Verify Pattern

```
1. devbox_project_deploy with project_dir → deploy
2. devbox_project_status with project_dir → verify containers running
3. notify_telegram → confirm deployment
```

### Health-Monitor-and-Recover Pattern

```
1. homelab_health → identify down services
2. For each down service: media_logs → diagnose → media_restart
3. homelab_health (after 30s cache expires) → verify recovery
4. notify_telegram if unrecovered
```

### Download-Troubleshoot Pattern

```
1. radarr_get_queue → find stuck item
2. radarr_check_releases with tmdb_id → see rejection reasons
3. radarr_blocklist_release → remove bad release, retry search
4. radarr_get_queue → confirm new download started
```

### Full-Stack Status Pattern

```
media_dashboard
→ single call replaces: proxmox_get_node_metrics + devbox_docker_ps
  + radarr_get_queue + sonarr_get_queue + radarr_list_movies
  + sonarr_list_series + storage check + GPU check + SABnzbd/Prowlarr/Seerr health
```

---

## Troubleshooting Recipes

### Container Won't Start

```
1. devbox_docker_ps → confirm it's down
2. media_logs with container:"<name>", lines:200 → check crash reason
3. devbox_docker_compose with action:"logs", project_dir, service → compose-level logs
4. devbox_docker_compose with action:"restart", project_dir, service → restart
```

### Download Stuck in Queue

```
1. sabnzbd_get_status → check speed, disk space, queue size
2. sabnzbd_list_queue → see what's queued
3. If disk full: devbox_exec with command:"df -h" → find the bottleneck
4. sabnzbd_pause_queue / sabnzbd_resume_queue → cycle the queue
5. sabnzbd_delete_item with nzo_id → remove problematic NZB
```

### Proxmox Resource Pressure

```
1. proxmox_get_node_metrics → CPU, RAM, disk, load
2. proxmox_list_vms → which VMs/CTs are running
3. For each heavy VM: proxmox_get_metrics with vmid, type → detailed metrics
4. proxmox_stop_vm for idle VMs → free resources
```

### Indexer Not Working

```
1. prowlarr_list_indexers → check which are enabled
2. prowlarr_test_indexers with indexer_id → test specific indexer
3. prowlarr_sync_apps → push indexer config to Radarr/Sonarr
```

### Media Not Appearing in Plex

```
1. radarr_list_movies or sonarr_list_series → confirm file downloaded (✓ mark)
2. devbox_exec → check file exists at expected path
3. plex_refresh_library with library_name → trigger scan
4. plex_recently_added → verify it appeared
```

---

## Tool Dependency Map

```
media_dashboard
├── proxmox_get_node_metrics (via Proxmox API)
├── devbox_docker_ps (via SSH)
├── radarr_get_queue (via HTTP)
├── sonarr_get_queue (via HTTP)
├── radarr_list_movies (library stats)
├── sonarr_list_series (library stats)
├── disk usage (via Proxmox SSH)
├── nvidia-smi (via Proxmox SSH)
└── media-health.py (via Devbox SSH → SABnzbd, Prowlarr, Seerr)

devbox_project_deploy
├── git pull (via SSH)
├── docker compose pull (via SSH)
├── docker compose up -d (via SSH)
└── docker compose ps (via SSH)

proxmox_create_ct
├── Proxmox /cluster/nextid (API)
└── Proxmox /nodes/{node}/lxc POST (API)
    ├── PROXMOX_CT_TEMPLATE
    ├── PROXMOX_CT_STORAGE
    ├── PROXMOX_CT_BRIDGE
    └── PROXMOX_GATEWAY
```

---

## Environment Variables Reference

See `.env.example` for the complete template. Key orchestration variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `DEVBOX_PROJECTS_DIR` | Where compose projects live | `/opt/projects` |
| `MEDIA_LXC_ID` | LXC ID of media stack (for GPU/security checks) | — |
| `DASHBOARD_DISK_PATHS` | Disk paths shown in media_dashboard | — |
| `MEDIA_CONTAINERS` | Comma-separated container names for logs/restart | `plex,radarr,sonarr,sabnzbd,seerr,prowlarr,flaresolverr` |
| `SSH_STRICT_HOST_KEY` | Enable known_hosts verification | `false` |
| `PROXMOX_TLS_VERIFY` | Validate Proxmox TLS certs | `false` |

---

*Generated for homelab-mcp v2.1.0 — 2026-06-09*
