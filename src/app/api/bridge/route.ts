import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, unlinkSync, readFileSync, writeSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";

/**
 * GET /api/bridge — bridge supervisor.
 *
 * The agent-service (socket.io bridge on :3003 + admin API on :3004) normally
 * runs forever, but if it ever dies this endpoint revives it. The service is
 * spawned as a DETACHED child of this Next.js dev-server process, so it keeps
 * running independently of any shell session.
 *
 * Spawn safety (learned the hard way):
 *  - Multiple browsers auto-revive concurrently (every 30s each), and stale
 *    dev-server workers can serve old compiled versions of this route — so
 *    this handler MUST be safe to run concurrently and with mixed versions.
 *  - bun can bind the same port from several processes (SO_REUSEPORT), which
 *    split-brains the bridge (extension on one instance, admin API on
 *    another). Therefore: NEVER spawn when anything already listens on the
 *    ports, and hold a lockfile so only one spawner acts at a time.
 */
const SERVICE_DIR = "/home/z/my-project/mini-services/agent-service";
const LOG_FILE = "/tmp/agent-service.log";
const AGENT_PORT = 3003;
const ADMIN_PORT = 3004;
/* Data lives OUTSIDE the service source tree: hot reloads (if ever used) must
 * never watch the service's own persistence writes, and the service must not
 * restart when it saves its state. */
const AGENT_DATA_DIR = "/tmp/agent-service-data";
const SPAWN_LOCK = "/tmp/agent-service.spawn.lock";
const SPAWN_LOCK_TTL_MS = 30_000;

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

/** Is ANY process listening on this port? (TCP-level truth, cheap) */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host: "127.0.0.1", timeout: 1200 }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.on("timeout", () => {
      s.destroy();
      resolve(false);
    });
  });
}

/** Wait (max `ms`) for the admin API to answer /status. */
async function waitUntilUp(ms: number): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const st = await adminGet("/status");
    if (st?.ok) return st;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function GET() {
  const before = await adminGet("/status");
  if (before?.ok) {
    return NextResponse.json({ ok: true, spawned: false, status: before });
  }

  if (!existsSync(path.join(SERVICE_DIR, "index.ts"))) {
    return NextResponse.json({ ok: false, error: "agent-service not found on disk" }, { status: 500 });
  }

  // Anything listening on the bridge ports? A service (or a duplicate) is
  // coming up or wedged — NEVER spawn on top of it: bun shares ports across
  // processes (SO_REUSEPORT), which split-brains the bridge. Wait for it.
  const [p3, p4] = await Promise.all([portOpen(AGENT_PORT), portOpen(ADMIN_PORT)]);
  if (p3 || p4) {
    const st = await waitUntilUp(12_000);
    if (st?.ok) {
      return NextResponse.json({ ok: true, spawned: false, status: st, note: "another instance was starting — no spawn" });
    }
    return NextResponse.json(
      { ok: false, error: `port ${p3 ? AGENT_PORT : ADMIN_PORT} is held but the admin API does not answer — the wedged instance needs a manual restart` },
      { status: 503 },
    );
  }

  // Spawn lock: only ONE spawner acts at a time (concurrent browser revives,
  // stale route workers, etc). A fresh lock (<TTL) means someone else won.
  try {
    const fd = openSync(SPAWN_LOCK, "wx");
    writePid(fd);
  } catch {
    // lock exists — fresh or stale?
    try {
      const age = Date.now() - Math.trunc(Number(readFileSync(SPAWN_LOCK, "utf8").split(":")[0]) || 0);
      if (age < SPAWN_LOCK_TTL_MS) {
        const st = await waitUntilUp(15_000);
        if (st?.ok) {
          return NextResponse.json({ ok: true, spawned: false, status: st, note: "spawned by a concurrent revive" });
        }
        return NextResponse.json({ ok: false, error: "another revive is mid-spawn and the service did not come up" }, { status: 503 });
      }
      // stale lock — take over
      unlinkSync(SPAWN_LOCK);
      const fd = openSync(SPAWN_LOCK, "wx");
      writePid(fd);
    } catch {
      const st = await waitUntilUp(15_000);
      return NextResponse.json(st?.ok ? { ok: true, spawned: false, status: st } : { ok: false, error: "revive lock contention" }, { status: st?.ok ? 200 : 503 });
    }
  }

  try {
    const logFd = openSync(LOG_FILE, "a");
    // plain `bun index.ts` — NO --hot: hot-reloading a stateful socket server
    // re-evaluates the module graph and drops the VS Code extension + all
    // paired browsers whenever the service writes its own data files. Code
    // changes are rare and get a deliberate restart instead.
    const child = spawn("bun", ["index.ts"], {
      cwd: SERVICE_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AGENT_PORT: String(AGENT_PORT),
        AGENT_ADMIN_PORT: String(ADMIN_PORT),
        AGENT_DATA_DIR,
      },
    });
    child.unref();
  } catch (e) {
    try { unlinkSync(SPAWN_LOCK); } catch { /* best effort */ }
    return NextResponse.json(
      { ok: false, error: `spawn failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  const after = await waitUntilUp(15_000);
  try { unlinkSync(SPAWN_LOCK); } catch { /* best effort */ }
  if (after?.ok) {
    return NextResponse.json({ ok: true, spawned: true, status: after });
  }
  return NextResponse.json(
    { ok: false, error: "agent-service did not come up within 15s (see /tmp/agent-service.log)" },
    { status: 500 },
  );
}

function writePid(fd: number) {
  writeSync(fd, `${Date.now()}:${process.pid}`);
  closeSync(fd);
}
