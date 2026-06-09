# Changelog

All notable changes to the homelab-mcp server.

## [2.0.1] — 2026-06-09

### Added
- Community health files: issue/PR templates, CODE_OF_CONDUCT.md
- Status badges (CI, npm, license, node) in README
- `.nvmrc` for automatic Node.js version switching
- `.npmrc` with `engine-strict=true` to enforce Node.js >=20
- `.claude/` directory added to `.gitignore`
- Author field in `package.json`
- Expanded npm keywords for better discoverability

### Changed
- Prometheus and Grafana are now optional — server starts without them
- Populated `.mcp.example.json` with a working config example

### Fixed
- Typo: `serrModule` → `seerrModule` in Seerr module export
- Missing security contact in SECURITY.md

## [2.0.0] — 2026-06-03

### Added
- Modular architecture with `ToolModule` interface and pluggable registry (`registry.ts`)
- **9 new service integrations**: Tautulli, Bazarr, AdGuard Home, Proxmox Backup Server, Uptime Kuma, Lidarr, Readarr, Tailscale, Watchtower (container updates)
- **12+ new tools** across all domains
- `homelab_capabilities` meta-tool for AI-driven service discovery
- `media_dashboard` — all-in-one homelab status overview
- `notify_telegram` — send alerts to Telegram
- Graceful optional module loading (missing env vars → skip with warning)
- `container_check_updates` / `container_update` tools
- `wol_send` (Wake-on-LAN) and `tailscale_status` networking tools
- Security status check (`security_status`)
- Scaffolding script (`npm run new-module`)

### Changed
- Replaced qBittorrent with SABnzbd as download client
- Replaced Discord webhooks with Telegram bot notifications
- Full refactor: API clients, tool implementations, and module definitions separated into clean layers
- All media tools now use devbox SSH directly
- Path mappings support for Radarr and Sonarr

### Fixed
- SSH key path resolution for cross-platform support
- dotenv path resolution for Claude Desktop compatibility
- ProxmoxSSH key-based auth after disabling password login

## [1.0.0] — 2025

### Added
- Initial release with Proxmox VE management (list, start, stop, restart, create CT, metrics, logs)
- Devbox SSH execution with safety filters (exec, read/write files, list dirs, Docker, Git)
- Full media stack: Radarr, Sonarr, Plex, Overseerr, Prowlarr, qBittorrent
- GPU monitoring via nvidia-smi
- QNAP NAS support (RAID status, SMART, storage usage)
- Prometheus metrics querying and snapshot
- Grafana dashboard listing and panel data querying
