# Z.ai Workspace Bridge — Source Update (2026-11-19)

This drop updates the bridge project to the exact source currently running
in the z.ai sandbox chat (preview: preview-chat-b10b3b1d-3ded-4365-a24d-073caed0836b.space-z.ai).
Everything below is what's live right now — nothing was re-typed or summarized.

## What's new since the last zip

1. **AI Code Agent extension v0.5.0 — full source + VSIX.**
   The original VSIX only ever existed on the old Windows machine, so the
   extension was rebuilt from the documented wire protocol in
   `mini-services/agent-service/index.ts`:
   - Source: `extension/ai-code-agent/` (TypeScript, bundles with `bun build`)
   - Packaged: `public/ai-code-agent-0.5.0.vsix` — install with
     `code --install-extension ai-code-agent-0.5.0.vsix` or the Extensions
     panel → `···` → "Install from VSIX…"
   - Same protocol as 0.3.1/0.4.0 (identity in SecretStorage,
     `aiCodeAgent.serverUrl`, `hello` → `tool:exec`/`tool:result`), plus new
     commands: Set/Clear Workspace Identity, Copy Pairing Code, panel tree
     view in the Activity Bar, bash/PowerShell auto-detect for `run_command`.

2. **Dashboard "Reconnect kit" card** (`src/app/page.tsx`).
   While the workspace is offline the dashboard shows a setup card: the VSIX
   download button, the install command, this page's URL as the
   `aiCodeAgent.serverUrl` value, and the workspace id + secret — all with
   copy buttons. It disappears the moment VS Code connects.

3. **"How this works" guide updated** to the 0.5.0 commands and links the VSIX.

4. **Security: `mini-services/agent-service/data/` is now gitignored.**
   `state.json` holds the workspace id + secret and web tokens — anyone with
   those can claim the workspace slot on a bridge. The old zip carried them
   for private transfer; a public repo must not. The service regenerates
   `data/` automatically on first connect. If you ever want a state backup,
   keep it out of git.

## Files that matter

| Path | Role |
|------|------|
| `src/` | Next.js 16 dashboard (App Router, Tailwind 4, shadcn/ui) |
| `mini-services/agent-service/index.ts` | Bridge server: socket.io :3003 + operator API :3004 |
| `scripts/bridge.mjs` | Operator CLI the z.ai AI session drives |
| `extension/ai-code-agent/` | VS Code extension source |
| `public/ai-code-agent-0.5.0.vsix` | Installable extension package |
| `Caddyfile` | :81 gateway → :3000, `?XTransformPort=` → any service port |

## Running it locally (needs bun + node on this machine)

```bash
bun install                      # root (dashboard deps)
cd mini-services/agent-service && bun install && cd ../..
bun run dev                      # dashboard on :3000
cd mini-services/agent-service && bun run dev   # bridge on :3003/:3004
caddy run --config Caddyfile    # gateway on :81
```

`.env` ships with `DATABASE_URL` pointing at
`/home/kirby/Documents/z.ai-workspace-bridge/db/custom.db` — edit it if you
move the project. `.env` is gitignored.

## Updating your repo

The workspace folder is git-initialized with everything staged. To publish:

```bash
git commit -m "Sync bridge source: extension v0.5.0 + reconnect kit dashboard"
git remote add origin https://github.com/<you>/<repo>.git   # if not set yet
git push -u origin main
```

If the repo already exists remotely with history, instead do:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git fetch origin && git reset --soft origin/main   # keep files, replay on history
git commit -m "Sync bridge source from z.ai sandbox"
git push
```

## Reconnecting a fresh z.ai chat with this repo

Same as README-BRIDGE-MIGRATION.md: unzip/clone this, `bun install` at the
root and in `mini-services/agent-service`, start bridge + dashboard + Caddy.
The extension (0.5.0) connects with `aiCodeAgent.serverUrl` = the dashboard
URL; use **AI Code Agent: Set Workspace Identity…** to restore a workspace
identity if you have one, or just connect — the bridge pairs fresh and shows
a new 6-char code for the browser.
