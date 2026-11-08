import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import path from "node:path";

/**
 * GET /api/bridge — bridge supervisor.
 *
 * The agent-service (socket.io bridge on :3003 + admin API on :3004) normally
 * runs forever, but if it ever dies this endpoint revives it. The service is
 * spawned as a DETACHED child of this Next.js dev-server process, so it keeps
 * running independently of any shell session.
 *
 * Idempotent: if the admin API already answers, nothing is spawned.
 */
const SERVICE_DIR = "/home/z/my-project/mini-services/agent-service";
const LOG_FILE = "/tmp/agent-service.log";
const AGENT_PORT = 3003;
const ADMIN_PORT = 3004;

export const dynamic = "force-dynamic";

async function adminGet(pathname: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${ADMIN_PORT}${pathname}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const before = await adminGet("/status");
  if (before?.ok) {
    return NextResponse.json({ ok: true, spawned: false, status: before });
  }

  if (!existsSync(path.join(SERVICE_DIR, "index.ts"))) {
    return NextResponse.json({ ok: false, error: "agent-service not found on disk" }, { status: 500 });
  }

  try {
    const logFd = openSync(LOG_FILE, "a");
    const child = spawn("bun", ["--hot", "index.ts"], {
      cwd: SERVICE_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AGENT_PORT: String(AGENT_PORT),
        AGENT_ADMIN_PORT: String(ADMIN_PORT),
      },
    });
    child.unref();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `spawn failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // wait (max ~10s) for the freshly spawned service to answer
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const after = await adminGet("/status");
    if (after?.ok) {
      return NextResponse.json({ ok: true, spawned: true, status: after });
    }
  }
  return NextResponse.json(
    { ok: false, error: "agent-service did not come up within 10s (see /tmp/agent-service.log)" },
    { status: 500 },
  );
}
