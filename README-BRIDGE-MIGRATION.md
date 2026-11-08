# Z.ai Workspace Bridge — Migration Guide

This zip contains the complete "Z.ai Workspace Bridge" web app — the
dashboard that says *"Chat with GLM on z.ai · watch every action on your
workspace here"* — plus its backend bridge service and the live pairing
state, so a fresh z.ai chat can stand it up and your VS Code workspace
reconnects WITHOUT rebuilding anything.

## What's inside (3 pieces)

| Piece | Location | Role |
|-------|----------|------|
| Dashboard (Next.js 16) | `src/`, `public/`, configs | The preview website: live activity feed, file tree, status, chat panel |
| Bridge backend | `mini-services/agent-service/` | Bun service: socket.io bridge on :3003 + admin API on :3004. Talks to the VS Code extension |
| Operator CLI | `scripts/bridge.mjs` | How the AI session reads/writes/runs commands in the user's VS Code workspace |
| Reverse proxy | `Caddyfile` | :81 → Next.js :3000; `?XTransformPort=` → any service port |

**Live state included** in `mini-services/agent-service/data/`:
`state.json` (workspace identity: id + secret, pairing code `VE8QPM`, web
tokens), `activity.json` (the dashboard journal), `tree.json` (cached tree).

## Run it in a new z.ai chat

Tell the AI in the new chat:

> Unzip this, then: `bun install` at the project root, `cd
> mini-services/agent-service && bun install`, start the bridge with `bun
> run dev` (port 3003/3004), start the site with `npm run dev` (port 3000),
> and run Caddy with the included Caddyfile on port 81.

The site auto-revives the bridge service too — hitting `/api/bridge`
re-spawns the agent-service if it died.

## Reconnect your VS Code (the only manual step)

The extension is already installed on your machine (ai-code-agent 0.4.0) —
do NOT reinstall or re-pair from scratch:

1. Open the new chat's preview page (the dashboard) in your browser
2. Copy its URL from the address bar
3. In VS Code → Settings → search `aiCodeAgent.serverUrl` → paste the new
   preview URL
4. Reload VS Code (or click Connect in the AI Code Agent panel)

The extension's workspace identity (id + secret in VS Code SecretStorage)
matches the `state.json` shipped in this zip, so the new bridge recognizes
it instantly — same workspace, no re-pairing.

**Browser pairing** (for the chat's AI session to get file tools): enter
the 6-character code shown in the VS Code connector panel — current code:
`VE8QPM` (it rotates; use whatever the panel shows).

## How the AI session operates the workspace

```bash
node scripts/bridge.mjs status        # connection + workspace summary
node scripts/bridge.mjs tree          # full file tree (JSON)
node scripts/bridge.mjs read <path>   # file contents
node scripts/bridge.mjs write <path> <content | ->
node scripts/bridge.mjs edit <path> <old | -> <new | ->
node scripts/bridge.mjs run "<command>" [--timeout <ms>]
node scripts/bridge.mjs diagnostics
node scripts/bridge.mjs note "text shown on the dashboard"
```

## Notes for the new chat's AI

- Paths are pinned to `/home/z/my-project` (the standard z.ai container
  project root) — `src/app/api/bridge/route.ts` spawns the service from
  there, and `.env`'s `DATABASE_URL` points at `db/custom.db`. If the
  project root differs, adjust `SERVICE_DIR` in the bridge route.
- The user's actual project (app-store-specs) lives on their Windows
  machine at `C:\Users\user\OneDrive\Documents\SPECS\app-store-specs` —
  reached ONLY through this bridge. Its source is also archived separately
  (`app-store-specs-source.zip`) if the user uploads it too.
- Everything the dashboard shows flows through the agent-service journal —
  nothing touches the user's machine except via the paired extension.
