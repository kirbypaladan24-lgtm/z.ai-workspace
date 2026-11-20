# Migrate this drop into your VS Code (2026-11-20, latest)

This drop is the complete sandbox state: the premium "Obsidian & Emerald"
dashboard re-theme, the Roblox Studio plugin, and the VS Code extension
(source + VSIX), all committed. To use everything on your machine:

1. **Get the code** — `git pull origin main` in your existing clone, or
   clone the repo fresh in VS Code (`Ctrl+Shift+P` → "Git: Clone").
2. **Install / update the extension** — the repo ships the current
   package: `code --install-extension public/ai-code-agent-0.5.0.vsix`
   (or Extensions panel → `···` → "Install from VSIX…"). The VSIX is
   built from the exact `extension/ai-code-agent/src/extension.ts` in
   this commit — nothing newer exists.
3. **Point it at the bridge** — VS Code Settings → "AI Code Agent" →
   `serverUrl` = the dashboard preview URL (this page's origin). The
   extension connects its socket to `<serverUrl>/?XTransformPort=3003`.
4. **Pair** — Connect from the AI Code Agent sidebar; the dashboard shows
   the 6-char code (or use **Set Workspace Identity…** to restore a
   prior identity — the bridge then re-pairs silently).
5. **Roblox Studio (optional)** — download `/zai-bridge-roblox.rbxm`
   from the dashboard's Setup view, drop it into your Studio `Plugins`
   folder, enable **Game Settings → Security → Allow HTTP Requests**,
   then Connect + pair. It mirrors the VS Code operations and streams
   your game's DataModel into the workspace tree.

### Pushing this state (the sandbox cannot hold your GitHub credentials)

Your remote `main` (`2f64f0d` "make glm smarter") is already an ancestor
of this history — the push is a clean fast-forward that keeps every
commit on both sides. Two ways to make it happen:

- **Option A — push from your machine, no token sharing.** Download
  `zai-workspace-ready-to-push.bundle` from this dashboard (a complete
  git bundle of every commit), then:
  ```bash
  git clone zai-workspace-ready-to-push.bundle zai-push-tmp
  cd zai-push-tmp
  git remote set-url origin https://github.com/kirbypaladan24-lgtm/z.ai-workspace.git
  git push origin main        # authenticates with YOUR GitHub login
  ```
- **Option B — let the sandbox push.** Create a fine-grained PAT
  (GitHub → Settings → Developer settings → Personal access tokens;
  scope: only `z.ai-workspace`, permission: Contents → Read and write;
  short expiry) and paste it into the z.ai chat. The agent runs
  `bash /home/z/push-bridge.sh <TOKEN>` with it, once, inline.

Everything below is the earlier change log, unchanged.

---

# Z.ai Workspace Bridge — Source Update (2026-11-20)

This drop updates the bridge project to the exact source currently running
in the z.ai sandbox chat (preview: preview-chat-b10b3b1d-3ded-4365-a24d-073caed0836b.space-z.ai).

## What's new since the last zip

1. **Roblox Studio plugin — same bridge, for game development.**
   `roblox-plugin/src/ZAIWorkspaceBridge/init.server.luau` is a self-contained
   Luau plugin (toolbar button + dock widget, "Obsidian & Emerald" theme)
   that mirrors the VS Code extension: pairing, live game tree, script
   read/write, search, and activity mirroring. Studio plugins have no
   WebSockets, so it talks to the service over HTTP long-polling through
   the Caddy gateway (`/rbx/*?XTransformPort=3005`).
   - Built artifacts served from the dashboard: `/zai-bridge-roblox.rbxm`
     (binary, built with rojo 7.7.1) and `/zai-bridge-roblox.rbxmx`
     (XML variant; regenerate with `node scripts/build-rbxmx.mjs`).
   - Setup view gained a "Roblox Studio bridge" card: download, plugins
     folder paths, the "Allow HTTP Requests" requirement, and connect/pair
     steps.
   - `mini-services/agent-service/rbx.ts` (new): the plugin-facing API —
     `POST /rbx/register|poll|result|tree|activity|unregister`. Slot
     semantics mirror the extension: one workspace slot, same-identity
     reconnects persist (paired browsers stay paired), VS Code takeover
     evicts the plugin (and vice versa), stale sessions close after 45s.
     Tool calls route to the plugin automatically whenever it is the live
     client — the dashboard's file:read, tree refresh, and the GLM admin
     API (`/run`) all execute against the game's DataModel. Shell tools
     (run_command, get_diagnostics) are refused with a clear message.
   - Dashboard/status: `client` (`vscode`/`roblox`) + `roblox` info in
     status payloads; knowledge/verification/skills syncs are skipped while
     the Roblox client owns the slot (no `.skills/`/`knowledge/` folders in
     a game tree — the local caches are untouched).

## Verified

- 23-assertion E2E through the real gateway: register → dashboard pair →
  tree push → file:read round-trip → admin /run routing via the plugin →
  concurrent-session 409s → identity persistence → VS Code takeover
  eviction → knowledge cache intact. (Temporary check script, removed.)
- `bun run lint` clean; dev.log + service log clean; browser-verified the
  Setup card, downloads (200, 16 KB / 36 KB), and no console errors.
- Service state (workspace identity, 204-entry journal, knowledge caches)
  restored from git history after live testing; single instance owned by
  the platform supervisor (`/api/bridge`).

---

# Previous update (2026-11-19)

Everything below is what was live at that point — nothing was re-typed or summarized.

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

# UI Redesign — clean dashboard shell (2026-11-19, later drop)

The dashboard (`/`) was rebuilt from a single 2,579-line wall-of-cards page
into a clean sidebar-nav console. **No behavior changed** — every socket
event, action, confirmation pattern and `data-testid` is preserved.

## New structure

- `src/app/page.tsx` (915 lines) — shell: socket wiring (verbatim), state,
  actions, sidebar nav + mobile header, view switching, status-bar footer.
- `src/components/bridge/` — focused modules:
  - `types.ts` — all shared types + helpers (fmtBytes, status metas, …)
  - `bits.tsx` — primitives (Panel, StatCard, StatTile, Dot, EmptyState,
    LockedPanel, FeedChip, SubToggle, CopyField, FileIconFor)
  - `overview.tsx` — health cards, stat tiles, recent activity, quick links
  - `activity.tsx` — live feed + expandable diffs + raw-events console
  - `workspace.tsx` — explorer + side-by-side file preview (sticky on xl)
  - `knowledge.tsx` — library, record detail, verification run explorer
  - `skills.tsx` — skills list + viewer
  - `setup.tsx` — pairing hero, reconnect kit, how-it-works guide

## UX changes

- Six views (Overview / Activity / Workspace / Knowledge / Skills / Setup)
  with a desktop sidebar and a mobile tab strip; the active view syncs to
  the URL hash (`#knowledge`) so refresh keeps your place.
- First-run pairing is a centered hero on Overview; the reconnect kit and
  the how-it-works guide moved to Setup, decluttering the main page.
- Typography bumped from 8.5–10px density to 11–13px; consistent panels,
  calmer headers, uniform stat tiles and quick-link cards.
- Verification evidence now jumps to the Workspace file preview.
- Fixed: footer now truly sticks on short pages (sidebar h-screen + footer
  forced a 28px overflow before); activity rows no longer echo the tool
  name when an entry has no path.
- `next.config.ts`: `devIndicators: false` (no floating dev-tools bubble).

## Verified

- `bun run lint` and `bunx tsc --noEmit` clean; dev.log no errors.
- Agent-browser E2E through the :81 gateway: paired with U3FV8J, all six
  views exercised, EXP-000008 + VRUN-000003 detail (timeline, stats, test
  explorer, analyses, conclusion) rendered, file preview opened, footer
  stickiness + mobile layout + hash routing confirmed. Screenshots in
  `scripts/verifications/ui-redesign-*.png`.
