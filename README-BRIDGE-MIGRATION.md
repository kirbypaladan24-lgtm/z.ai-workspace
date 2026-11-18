# Z.ai Workspace Bridge — Setup & Migration Guide

This project is the complete "Z.ai Workspace Bridge" web app — the dashboard
that says *"Chat with GLM on z.ai · watch every action on your workspace
here"* — plus its backend bridge service, so a fresh z.ai chat can stand it
up and your VS Code workspace connects WITHOUT rebuilding anything.

## What's inside (5 pieces)

| Piece | Location | Role |
|-------|----------|------|
| Dashboard (Next.js 16) | `src/`, `public/`, configs | The preview website: live activity feed, file tree, status, chat panel |
| Bridge backend | `mini-services/agent-service/` | Bun service: socket.io bridge on :3003 + admin API on :3004. Talks to the VS Code extension |
| Operator CLI | `scripts/bridge.mjs` | How the AI session reads/writes/runs commands in the user's VS Code workspace |
| Reverse proxy | `Caddyfile` | :81 → Next.js :3000; `?XTransformPort=` → any service port |
| VS Code extension | `extension/ai-code-agent/` + `public/ai-code-agent-0.5.0.vsix` | The connector (full source + installable package) |

## Stand it up in a fresh z.ai chat

Tell the AI in the new chat:

> Clone this repo (or unzip the copy I gave you), then: `bun install` at the
> project root, `cd mini-services/agent-service && bun install`, start the
> bridge with `bun run dev` (port 3003/3004), start the site with `bun run
> dev` (port 3000), and run Caddy with the included Caddyfile on port 81.

Runtime state (`state.json`, `activity.json`, `tree.json` in
`mini-services/agent-service/data/`) is NOT shipped and is gitignored — the
service regenerates it on first connect. **Every new bridge starts with a
clean, empty journal and a fresh pairing code.**

The site auto-revives the bridge service too — hitting `/api/bridge`
re-spawns the agent-service if it died.

## Connect your VS Code

1. Install the extension if this machine doesn't have it: Extensions panel →
   `···` (Views and More Actions) → **Install from VSIX…** → pick
   `public/ai-code-agent-0.5.0.vsix` (or terminal:
   `code --install-extension public/ai-code-agent-0.5.0.vsix`). Already
   installed? Skip.
2. Open the new chat's preview page (the dashboard) in your browser and copy
   its URL from the address bar.
3. VS Code → Settings (`Ctrl+,`) → search `aiCodeAgent.serverUrl` → paste
   the preview URL.
4. Reload VS Code (or Command palette → `AI Code Agent: Connect`).
5. Optional, only when migrating from a previous bridge install: Command
   palette → `AI Code Agent: Set Workspace Identity…` with the workspace id +
   secret from the old setup to be recognized as the same workspace.
   Skipping this pairs fresh — which is the clean default.

**Browser pairing** (so the chat's AI session gets file tools): enter the
6-character pairing code shown in the VS Code connector panel (the status
bar `AIA` item or the AI Code Agent Activity Bar panel). The code rotates on
every fresh bridge start — use whatever the panel shows.

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

## Notes for a new chat's AI

- The dashboard spawns the agent-service via `src/app/api/bridge/route.ts`
  and reads `.env`'s `DATABASE_URL`. Paths are relative to the project root
  wherever it runs; adjust `SERVICE_DIR` in the bridge route if the root
  differs.
- The user's real project lives on THEIR machine — reached ONLY through the
  paired extension. Never assume local files.
- Everything the dashboard shows flows through the agent-service journal —
  nothing touches the user's machine except via the paired extension.
- One VS Code connection at a time: a second window (or a second chat's
  bridge) connecting with the same identity evicts the previous one.

## Security notes

- `mini-services/agent-service/data/` holds the workspace secret + web
  tokens at runtime. It is gitignored — NEVER commit or ship it.
- Keep the repo private unless you deliberately want it public — it is your
  bridge infrastructure.
