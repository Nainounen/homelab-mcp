# Changelog

All notable changes to the homelab-mcp server.

## [2.4.0] — 2026-06-11

### Security
- **Shell injection fixed in `devbox_git` clone**: the target directory was interpolated inside double quotes, so a `repo_dir` containing `$(…)` executed on the devbox — now passed through `shellEscape` like every other argument
- **Safety filter hardened**: `rm` with recursive+force flags in any order or spelling (`-fr`, `-r -f`, `--recursive --force`, `-rfv`) targeting an absolute path is now blocked on both devbox and Proxmox (was: only literal `-rf`)
- **`.env` injection fixed in setup wizard**: `configure` values containing newlines could append arbitrary extra lines to `.env` — now rejected by schema validation

### Added
- **Output size cap**: every tool result is truncated at `MAX_OUTPUT_CHARS` (default 30,000 chars ≈ 7,500 tokens, `0` disables) so a stray `cat` of a huge file can't flood the AI context
- **Library list filters**: `radarr_list_movies` and `sonarr_list_series` accept `filter` (missing/downloaded-or-complete/unmonitored), `search`, and `limit` (default 100) — large libraries no longer dump thousands of lines per call

### Fixed
- **`homelab_health` false negatives**: Proxmox/Devbox/QNAP entries are bare hosts, not URLs, so their HTTP pings always failed — Proxmox is now probed at `https://HOST:PORT`, Devbox/QNAP via TCP on their SSH ports; services answering 401/403/404 now count as reachable; self-signed HTTPS no longer fails the reachability probe
- **`media_dashboard` storage section**: multiple `DASHBOARD_DISK_PATHS` were quoted as a single `df` argument and silently produced no output — each path is now escaped individually

### Performance
- **SSH keepalive + fast-fail connect** on devbox, Proxmox, and QNAP connections (`keepaliveInterval` 15s ×3, `readyTimeout` 15s) — dead peers are detected instead of hanging until command timeout
- **Server-side lookups**: Radarr/Sonarr single-item operations (add/remove/force-search/season-search/check-releases) query by `tmdbId`/`tvdbId` instead of fetching the entire library each call
- **`devbox_project_list`**: probes all projects in parallel with one combined SSH command each (was: two sequential round trips per project)
- **`ArrClient`**: HTTPS keep-alive agent added (HTTP-only before)

## [2.3.0] — 2026-06-09

### Security
- **Safety filter**: `rm -rf --no-preserve-root /` and similar flag variants now caught (was: only `rm -rf /` without flags between `-rf` and `/`)
- **Audit logging**: blocked commands logged to stderr with ISO timestamp; set `DEBUG_COMMANDS=true` to log executed commands
- **Defense-in-depth credential scanning**: all tool output scanned against known secret values from `.env` before returning to the AI — catches accidental credential leaks in upstream API responses
- `SECRET_KEY_PATTERNS` centralized in `utils.ts` as single source of truth (imported by `setup.ts`)
- Git clone URL validated against HTTP(S)/SSH patterns

### Added
- **Configurable SSH timeouts**: `DEVBOX_CMD_TIMEOUT` (default 30s) and `PROXMOX_CMD_TIMEOUT` (default 60s) env vars
- **HTTP retry logic**: `withRetry()` with exponential backoff (500ms → 1s → 2s) on network errors and 5xx; set `HTTP_RETRIES=0` to disable; applied to `ArrClient` (Radarr, Sonarr, Lidarr, Readarr) and `ProxmoxClient`
- **TTL cache eviction**: stale entries cleaned up every 100 writes or when cache exceeds 1000 entries
- **Setup wizard tests**: 12 test cases covering `.env` read/write, status reporting, secret masking, and error handling
- **Docker multi-tag publish**: `latest`, major (`2`), minor (`2.3`), and patch (`2.3.0`) tags pushed to `ghcr.io`

### Fixed
- **Version**: server info now reads from `package.json` at runtime (was: hardcoded `"2.1.0"`)
- **writeFile**: `echo '...'` replaced with `printf '%s' "..."` to handle base64 strings containing single quotes
- **MEDIA_CONTAINERS**: default fallback `seerr` → `overseerr` to match real-world Docker Compose service naming

## [2.2.0] — 2026-06-09

### Security
- **Safety filter**: `systemctl stop sshd`, `ssh.service`, and `ssh.socket` are now blocked (was: only `ssh`)
- **Path traversal**: `..` rejected in file read/write paths; writing to `/etc/`, `/boot/`, `/sys/` blocked; reading from sensitive system directories blocked
- Safety filter regex patterns and `sanitizeError` exported for direct test coverage (tests no longer duplicate implementation)

### Added
- **HTTP keep-alive** on all 11 HTTP clients (Proxmox, Radarr, Sonarr, Prowlarr, SABnzbd, Overseerr, Prometheus, Grafana, PBS, Uptime Kuma, AdGuard, Tautulli, Bazarr) — reduces TCP handshake overhead
- **O(1) tool dispatch**: `Map`-based lookup replaces linear `for...of` scan across all modules
- **Response caching**: `homelab_capabilities` (60s TTL) and `homelab_health` (30s TTL) via `cached()` utility
- **ESLint + Prettier** config for consistent code style
- **Integration tests**: 11 test cases covering module registry validation and tool dispatch with mocked clients
- **Orchestration docs**: `docs/orchestration.md` — workflows, automation patterns, troubleshooting recipes, tool dependency map

### Changed
- **`sanitizeError` moved to `utils.ts`** — shared between `index.ts` and tests, no more copy-paste
- **Media dashboard Python script extracted** to `scripts/media-health.py` — version-controllable, documented, properly formatted
- Vitest include pattern relaxed from `src/__tests__/**/*.test.ts` to `src/**/*.test.ts` for co-located tests
- All test suites now import directly from source modules instead of duplicating logic

## [2.1.0] — 2026-06-03

### Added
- AI-native setup wizard (`homelab_setup`) with three modes: status, configure, test
- Secret masking: `PASSWORD`, `API_KEY`, `TOKEN`, `SECRET` values replaced with `••••••••` in all AI-facing output
- Error sanitization: URLs, API keys, and token-like path segments redacted before reaching the MCP client
- Published to npm as `homelab-mcp`
- `.mcp.example.json` for MCP client configuration

### Changed
- Fixed npm package name, GitHub URLs, and author field
- Setup wizard credentials never exposed to the AI

## [2.0.1] — 2026-06-02

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
