# AI Code Agent — Z.ai Workspace Bridge

Connects your VS Code workspace to the **Z.ai Workspace Bridge** dashboard: your workspace appears live on the web dashboard, you pair your browser with a 6-character code, and the z.ai agent can list, read, edit, delete and move files, search code, run shell commands and read VS Code diagnostics — all executed locally on your machine, all visible on the dashboard.

## Setup (3 steps)

1. **Server URL** — Settings → search `aiCodeAgent.serverUrl` → paste the dashboard URL you open in your browser (just the base URL, no port, no trailing path). The extension connects its socket to `<serverUrl>/?XTransformPort=3003` automatically.

2. **Workspace identity (only when migrating machines)** — run `AI Code Agent: Set Workspace Identity…` from the Command Palette and paste the **Workspace ID** and **Workspace secret** of your previous setup. The bridge then recognizes your workspace, reconnects it as *persistent* and keeps the dashboard activity journal. Skipping this is fine too — the extension generates a fresh identity, but the bridge re-pairs its workspace slot and the server-side journal resets.

3. **Connect** — `AI Code Agent: Connect` from the Command Palette (or click the status bar item). If `aiCodeAgent.autoConnect` is on, it connects at startup.

## Pairing your browser

When connected, the **pairing code** (6 characters) is shown in:

- the status bar (`AIA ABC123`),
- the **AI Code Agent** panel in the Activity Bar.

Enter that code on the dashboard page to unlock the file tree, live activity feed and chat for that browser.

## What it does

- Publishes your workspace file tree to the dashboard (excluding `node_modules`, `.git`, `dist`, etc.)
- Watches local file changes and streams them to the activity feed
- Executes the bridge's tool calls locally: `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file` (trash-aware), `create_directory`, `move_path`, `search_code`, `run_command` (bash on Linux/macOS, PowerShell on Windows), `get_diagnostics`
- Forwards chat messages you send via `AI Code Agent: Send Message…`
- Logs everything the agent does to the **AI Code Agent** output channel

## Commands

| Command | What it does |
| --- | --- |
| `AI Code Agent: Connect` | Connect to the bridge |
| `AI Code Agent: Disconnect` | Disconnect |
| `AI Code Agent: Send Message…` | Send a chat message to the bridge |
| `AI Code Agent: Set Workspace Identity…` | Store the workspace ID + secret (migrating machines) |
| `AI Code Agent: Clear Workspace Identity` | Drop the stored identity |
| `AI Code Agent: Copy Pairing Code` | Copy the 6-character pairing code |
| `AI Code Agent: Open Settings` | Jump to the extension settings |

## Notes

- Only one VS Code window can hold the bridge connection — connecting from a second window evicts the first (you'll get a notification).
- Binary files are not returned raw by `read_file`; `run_command` is your escape hatch for those.
- `run_command` runs in the workspace root with a 2-minute default timeout (max ~3 minutes — the bridge server times tools out at 200s).
