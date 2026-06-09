# Security Policy

## Reporting a vulnerability

If you discover a security issue in homelab-mcp, please use GitHub's [private vulnerability reporting](https://github.com/ninomeier/homelab-mcp/security/advisories/new) or email **security@ninomeier.dev**. Do not open a public issue.

## Security model

homelab-mcp is a control plane for homelab infrastructure. It runs with the same privileges as the user it's configured with. Key considerations:

### SSH host keys

Host key verification is **disabled by default** because homelab host keys change frequently (container rebuilds, OS reinstalls). Set `SSH_STRICT_HOST_KEY=true` to enable standard `known_hosts` verification if your environment has stable host keys.

### TLS certificates

Proxmox VE and Proxmox Backup Server commonly use self-signed TLS certificates. Certificate verification is **disabled by default**. Set `PROXMOX_TLS_VERIFY=true` and `PBS_TLS_VERIFY=true` if you've configured trusted certificates.

### Credentials

All credentials live in a `.env` file that is never committed to git. The `.env.example` shows the required variables without real values. Never commit your `.env` file.

### Command safety filters

The `devbox_exec` and `proxmox_exec` tools have regex-based safety filters that block destructive commands (rm -rf /, mkfs, dd to block devices, shutdown, reboot, etc.). These filters are best-effort and not a substitute for proper access control.

### Network exposure

This MCP server is designed to run locally on your machine, connected to Claude Code or another MCP client. It communicates with your homelab services over your local network. Do not expose the MCP server itself to the internet.

## Supported versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | ✓ |
| < 2.0   | ✗ |
