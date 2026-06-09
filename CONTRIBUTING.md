# Contributing

Thanks for wanting to improve homelab-mcp.

## Architecture

The project follows a strict three-layer pattern designed for AI-assisted extensibility:

```
src/
├── {service}.ts          # Layer 1: API/SSH client factory (thin wrapper)
├── tools/{service}.ts    # Layer 2: Zod schemas + pure implementation functions
├── modules/{service}.ts  # Layer 3: Tool definitions + handler router
└── modules/registry.ts   # Central registry — add new modules here
```

## Adding a new service integration

The fastest way is the scaffolding script:

```bash
npm run new-module -- <Name>
```

This creates all three files with the correct naming conventions. Then:

1. Fill in the API calls in `src/tools/{slug}.ts`
2. Add env vars to `.env.example`
3. Register in `src/modules/registry.ts` (imports + client interface + `buildModules()`)
4. Add client instantiation in `src/index.ts`
5. Run `npm run build` to verify

See `src/modules/registry.ts` for detailed instructions.

## Conventions

- Tool names: `{service}_{action}` — e.g., `radarr_search_movie`, `proxmox_list_vms`
- Schema names: `{Service}{Action}Schema` (PascalCase)
- Client classes: `{Service}Client` — e.g., `RadarrClient`, `AdGuardClient`
- Factory functions: `create{Service}Client()` — reads env vars, throws if required ones are missing
- All tools return plain text (Markdown formatting encouraged)
- Zod schemas validate input before any side effects
- Optional modules: use `tryCreate()` in `index.ts` — missing env vars just log a warning

## Safety

- Destructive tools must use Zod to validate input before acting
- SSH `exec` tools go through a safety filter (`BLOCKED_PATTERNS` in `src/ssh.ts`)
- Error messages returned to the client are sanitized — full errors go to stderr

## Before submitting

1. `npm run build` passes with no errors
2. New env vars are documented in `.env.example`
3. Tool descriptions are clear enough for an AI to understand when to call them
