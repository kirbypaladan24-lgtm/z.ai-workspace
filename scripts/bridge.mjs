#!/usr/bin/env node
/**
 * bridge.mjs — the GLM operator CLI.
 *
 * This is how the AI session on z.ai web (running in this sandbox) drives the
 * user's REAL VS Code workspace: every command hits the agent-service admin
 * API on 127.0.0.1:3004, which dispatches tool:exec to the connected VS Code
 * extension. Every action is recorded in the activity journal and shown live
 * on the user's web dashboard + VS Code connector panel.
 *
 * Usage:
 *   node bridge.mjs status
 *   node bridge.mjs tree
 *   node bridge.mjs read <path>
 *   node bridge.mjs write <path> <content | ->        (- reads stdin)
 *   node bridge.mjs edit <path> <old_string | -> <new_string | ->
 *   node bridge.mjs delete <path>
 *   node bridge.mjs move <from> <to>
 *   node bridge.mjs mkdir <path>
 *   node bridge.mjs search <query> [--regex] [--include <glob>]
 *   node bridge.mjs run "<command>" [--timeout <ms>]
 *   node bridge.mjs diagnostics
 *   node bridge.mjs note "text to show on the dashboard"
 *   node bridge.mjs activity [limit]
 *   node bridge.mjs refresh
 *   node bridge.mjs clear-activity
 */
const BASE = 'http://127.0.0.1:3004';

function usage() {
  console.log(`
bridge.mjs — operate the user's VS Code workspace through the Z.ai bridge.

  status                     connection + workspace + tree summary
  tree                       full workspace file tree (JSON)
  read <path>                file contents
  write <path> <content|->   create/overwrite (- = read stdin)
  edit <path> <old|-> <new|->  replace exact text (unique match enforced)
  delete <path>              delete file/folder (OS trash)
  move <from> <to>           rename/move
  mkdir <path>               create folder
  search <query> [--regex] [--include <glob>]
  run "<command>" [--timeout <ms>]
  diagnostics                VS Code problems list
  note "text"                narrate on the user's dashboard
  activity [limit]           activity journal entries
  refresh                    ask VS Code to rescan the workspace
  clear-activity             wipe the activity journal
`);
}

async function readStdin() {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) chunks.push(c);
  return chunks.join('');
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(240_000) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(240_000),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function runTool(tool, args) {
  const { status, data } = await post('/run', { tool, args });
  if (status !== 200) {
    console.error(`admin API error ${status}:`, JSON.stringify(data));
    process.exit(1);
  }
  return data;
}

function fmtTree(node, prefix = '', isLast = true, out = []) {
  const label = node.path === '' ? `${node.name}/ (root)` : node.name + (node.type === 'dir' ? '/' : '');
  out.push(`${prefix}${node.path === '' ? '' : isLast ? '└─ ' : '├─ '}${label}${node.type === 'file' && node.size ? `  (${node.size} B)` : ''}`);
  if (node.type === 'dir' && node.children) {
    const kids = node.children;
    kids.forEach((c, i) => fmtTree(c, prefix + (node.path === '' ? '' : isLast ? '   ' : '│  '), i === kids.length - 1, out));
  }
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) { usage(); process.exit(1); }

  switch (cmd) {
    case 'status': {
      const { data } = await get('/status');
      console.log(JSON.stringify(data, null, 2));
      if (!data.connected) {
        console.error('\n⚠ Workspace is NOT connected — the user\'s VS Code (AI Code Agent extension) is offline.');
      }
      return;
    }
    case 'tree': {
      const { data } = await get('/tree');
      if (!data.ok) { console.error(data.error ?? 'no tree'); process.exit(1); }
      if (process.stdout.isTTY) {
        console.log(fmtTree(data.tree).join('\n'));
        console.error(`\n${data.stats.files} files, ${data.stats.dirs} dirs${data.stats.truncated ? ' (truncated)' : ''}`);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      return;
    }
    case 'read': {
      const p = rest[0];
      if (!p) { console.error('usage: read <path>'); process.exit(1); }
      const { data } = await get(`/file?path=${encodeURIComponent(p)}`);
      if (!data.ok) { console.error(data.result ?? 'read failed'); process.exit(1); }
      if (data.content !== undefined) console.log(data.content);
      else console.log(data.result);
      return;
    }
    case 'write': {
      const [p, content] = rest;
      if (!p || content === undefined) { console.error('usage: write <path> <content|->'); process.exit(1); }
      const body = content === '-' ? await readStdin() : content;
      const d = await runTool('write_file', { path: p, content: body });
      console.log(d.ok ? d.result : `FAILED: ${d.result}`);
      if (!d.ok) process.exit(1);
      return;
    }
    case 'edit': {
      const [p, oldS, newS] = rest;
      if (!p || oldS === undefined || newS === undefined) { console.error('usage: edit <path> <old|-> <new|->'); process.exit(1); }
      const oldStr = oldS === '-' ? (await readStdin()).replace(/\n$/, '') : oldS;
      const newStr = newS === '-' ? (await readStdin()).replace(/\n$/, '') : newS;
      const d = await runTool('edit_file', { path: p, old_string: oldStr, new_string: newStr });
      console.log(d.ok ? d.result : `FAILED: ${d.result}`);
      if (!d.ok) process.exit(1);
      return;
    }
    case 'delete': {
      const p = rest[0];
      if (!p) { console.error('usage: delete <path>'); process.exit(1); }
      const d = await runTool('delete_file', { path: p });
      console.log(d.ok ? d.result : `FAILED: ${d.result}`);
      if (!d.ok) process.exit(1);
      return;
    }
    case 'move': {
      const [from, to] = rest;
      if (!from || !to) { console.error('usage: move <from> <to>'); process.exit(1); }
      const d = await runTool('move_path', { from, to });
      console.log(d.ok ? d.result : `FAILED: ${d.result}`);
      if (!d.ok) process.exit(1);
      return;
    }
    case 'mkdir': {
      const p = rest[0];
      if (!p) { console.error('usage: mkdir <path>'); process.exit(1); }
      const d = await runTool('create_directory', { path: p });
      console.log(d.ok ? d.result : `FAILED: ${d.result}`);
      if (!d.ok) process.exit(1);
      return;
    }
    case 'search': {
      const query = rest[0];
      if (!query) { console.error('usage: search <query> [--regex] [--include <glob>]'); process.exit(1); }
      const args = { query };
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--regex') args.is_regex = true;
        else if (rest[i] === '--include') args.include = rest[++i];
      }
      const d = await runTool('search_code', args);
      console.log(d.result);
      return;
    }
    case 'run': {
      const command = rest[0];
      if (!command) { console.error('usage: run "<command>" [--timeout <ms>]'); process.exit(1); }
      const args = { command };
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--timeout') args.timeout_ms = parseInt(rest[++i], 10);
      }
      const d = await runTool('run_command', args);
      console.log(d.result);
      return;
    }
    case 'diagnostics': {
      const d = await runTool('get_diagnostics', {});
      console.log(d.result);
      return;
    }
    case 'note': {
      const text = rest.join(' ');
      if (!text) { console.error('usage: note "text"'); process.exit(1); }
      const { data } = await post('/note', { text });
      console.log(data.ok ? 'note delivered' : 'failed');
      return;
    }
    case 'activity': {
      const limit = rest[0] ? parseInt(rest[0], 10) : 50;
      const { data } = await get(`/activity?limit=${limit}`);
      for (const e of (data.entries ?? []).slice().reverse()) {
        const who = String(e.actor ?? '').padEnd(16);
        const what = (e.tool ?? e.fsType ?? e.kind ?? '').padEnd(16);
        const path = e.path ?? '';
        const ok = e.ok === undefined ? '' : e.ok ? '✓' : '✗';
        const ts = new Date(e.ts).toISOString().slice(11, 19);
        console.log(`${ts} ${who} ${what} ${ok} ${path}`.trimEnd());
      }
      return;
    }
    case 'refresh': {
      const { data } = await post('/refresh', {});
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    case 'clear-activity': {
      const { data } = await post('/activity/clear', {});
      console.log(data.ok ? 'cleared' : 'failed');
      return;
    }
    default:
      usage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`bridge error: ${e?.message ?? e}`);
  console.error('Is the agent-service running? (admin API on 127.0.0.1:3004)');
  process.exit(1);
});
