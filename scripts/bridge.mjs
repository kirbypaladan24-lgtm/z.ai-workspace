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
 *
 * Knowledge (adaptive intelligence layer):
 *   node bridge.mjs knowledge
 *   node bridge.mjs knowledge search <query> [--scope global|project|all]
 *                               [--category <c>] [--limit <n>] [--all] [--preflight]
 *   node bridge.mjs knowledge read <EXP-ID>
 *   node bridge.mjs knowledge submit --title "..." --problem "..." --solution "..."
 *                               [--scope global|project] [--category <c>]
 *                               [--symptoms ...] [--root-cause ...] [--environment ...]
 *                               [--applicable ...] [--limitations ...]
 *   node bridge.mjs knowledge attempt --problem "..." --approach "..."
 *                               [--result failed|partially_resolved|unresolved]
 *                               [--reason "..."] [--environment ...]
 *   node bridge.mjs knowledge feedback <EXP-ID> --outcome worked|failed|incompatible [--notes "..."]
 *   node bridge.mjs knowledge verify <EXP-ID> --check "<cmd>" [--check "<cmd>"]... [--version <n>]
 *   node bridge.mjs knowledge propose <EXP-ID> --solution "..." --reason "..."
 *                               [--symptoms ...] [--root-cause ...] [--environment ...]
 *                               [--applicable ...] [--limitations ...] [--compatibility ...]
 *   node bridge.mjs knowledge sync
 *
 * Verification (scientific verification engine):
 *   node bridge.mjs verification                        status + run list
 *   node bridge.mjs verification read <VRUN-ID>         full run detail (JSON)
 *   node bridge.mjs verification create --exp <EXP-ID> --json <file|->
 *   node bridge.mjs verification plan <VRUN-ID> --json <file|->
 *   node bridge.mjs verification start <VRUN-ID> [--confirm-dangerous]
 *   node bridge.mjs verification cancel <VRUN-ID> [--reason "..."]
 *   node bridge.mjs verification analyze <VRUN-ID> --json <file|->
 *   node bridge.mjs verification regress <VRUN-ID> --json <file|->
 *   node bridge.mjs verification report <VRUN-ID>
 *   node bridge.mjs verification sync
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

verification (scientific engine — GLM designs, the bridge executes & decides):
  verification               run list + counts
  verification read <id>     full run detail (timeline, cases, attempts)
  verification create --exp <EXP-ID> --json <file|->
                             observe + hypothesize (problem, hypothesis, env)
  verification plan <id> --json <file|->
                             submit the test plan (cases + criteria)
  verification start <id>    execute (owner reviews on the dashboard)
  verification cancel <id>   cancel a TESTING run
  verification analyze <id> --json <file|->
                             interpret results + metrics (bridge-validated)
  verification regress <id> --json <file|->
                             add a regression round (all rounds preserved)
  verification report <id>   assemble the final report from real records
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

/* ---- knowledge subcommand helpers ---- */

/** Parse `--flag value` / `--flag` style args into {flags, positional}. */
function parseFlags(argv, valueFlags) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && valueFlags.has(a.slice(2))) {
      flags[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) {
      flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const STATUS_GLYPH = {
  verified: '✔ verified',
  candidate: '… candidate',
  verification_pending: '⏳ verifying',
  rejected: '✗ rejected',
  deprecated: '⚠ deprecated',
  archived: '🗄 archived',
};

async function knowledgeCmd(sub, rest) {
  switch (sub) {
    case undefined:
    case 'status': {
      const { data } = await get('/knowledge');
      if (!data.ok) { console.error(data.error ?? 'knowledge store unavailable'); process.exit(1); }
      const c = data.counts;
      console.log(`knowledge store — ${data.online ? 'online' : 'OFFLINE (local cache)'} · project: ${data.projectName ?? '—'}${data.note ? ` · ${data.note}` : ''}`);
      console.log(`  verified ${c.verified} · candidates ${c.candidate} · pending ${c.verificationPending} · rejected ${c.rejected} · deprecated ${c.deprecated} · archived ${c.archived}`);
      console.log(`  failed attempts ${c.attempts} · feedback ${c.feedback} · audit lines ${c.audit}`);
      return;
    }
    case 'search': {
      const { flags, positional } = parseFlags(rest, new Set(['scope', 'category', 'limit']));
      const query = positional.join(' ');
      if (!query) { console.error('usage: knowledge search <query> [--scope global|project|all] [--category c] [--limit n] [--all] [--preflight]'); process.exit(1); }
      const { data } = await post('/knowledge/search', {
        query,
        scope: flags.scope,
        category: flags.category,
        limit: flags.limit ? parseInt(flags.limit, 10) : undefined,
        includeRejected: !!flags.all,
        preflight: !!flags.preflight,
      });
      if (!data.ok) { console.error(data.error ?? 'search failed'); process.exit(1); }
      if (data.hits.length === 0 && data.attemptWarnings.length === 0) {
        console.log(`no relevant knowledge found for "${query}" — proceed normally and do not invent prior experience`);
        return;
      }
      for (const h of data.hits) {
        console.log(`\n[${h.id}] ${h.title}  (${STATUS_GLYPH[h.status] ?? h.status} · v${h.activeVersion} · score ${h.score} · ${h.scope}${h.scope === 'project' ? `:${h.projectId}` : ''})`);
        console.log(`  problem: ${h.problemSummary}`);
        console.log(`  solution: ${h.solutionExcerpt}`);
        if (h.environment) console.log(`  environment: ${h.environment}`);
        if (h.applicableVersions) console.log(`  applicable: ${h.applicableVersions}`);
        if (h.limitations) console.log(`  limitations: ${h.limitations}`);
        console.log(`  verification: ${h.verificationStatus} — ${h.verificationSummary} · evidence ${h.evidenceCount} · reuse ${h.reuseStats.worked}✓/${h.reuseStats.failed}✗ of ${h.reuseStats.used}`);
      }
      for (const w of data.attemptWarnings) {
        console.log(`\n⚠ FAILED ATTEMPT [${w.id}] (${w.result}) — do NOT repeat this approach:`);
        console.log(`  problem: ${w.problemSummary}`);
        console.log(`  approach: ${w.approach}`);
        console.log(`  why it failed: ${w.failureReason}`);
      }
      return;
    }
    case 'read': {
      const id = rest[0];
      if (!id) { console.error('usage: knowledge read <EXP-ID>'); process.exit(1); }
      const { data } = await get(`/knowledge/record?id=${encodeURIComponent(id)}`);
      if (!data.ok) { console.error(data.error ?? 'not found'); process.exit(1); }
      console.log(JSON.stringify({ record: data.record, feedback: data.feedback }, null, 2));
      return;
    }
    case 'submit': {
      const { flags } = parseFlags(rest, new Set(['title', 'problem', 'solution', 'scope', 'category', 'symptoms', 'root-cause', 'environment', 'applicable', 'limitations']));
      if (!flags.title || !flags.problem || !flags.solution) {
        console.error('usage: knowledge submit --title "..." --problem "..." --solution "..." [--scope global|project] [--category c] [...]');
        process.exit(1);
      }
      const { status, data } = await post('/knowledge/submit', {
        title: flags.title,
        problemSummary: flags.problem,
        solutionSteps: flags.solution,
        scope: flags.scope,
        category: flags.category,
        symptoms: flags.symptoms,
        rootCause: flags['root-cause'],
        environment: flags.environment,
        applicableVersions: flags.applicable,
        limitations: flags.limitations,
      });
      if (status !== 200) { console.error(`submit failed: ${data.error}`); process.exit(1); }
      console.log(`submitted ${data.id} as CANDIDATE${data.flagged ? ' (⚠ flagged: possible secret-like text — review before global promotion)' : ''}`);
      console.log('next: knowledge verify ' + data.id + ' --check "<command that exercises the original failure>"');
      return;
    }
    case 'attempt': {
      const { flags } = parseFlags(rest, new Set(['problem', 'approach', 'result', 'reason', 'environment', 'experience']));
      if (!flags.problem || !flags.approach) {
        console.error('usage: knowledge attempt --problem "..." --approach "..." [--result failed|partially_resolved|unresolved] [--reason "..."]');
        process.exit(1);
      }
      const { status, data } = await post('/knowledge/attempt', {
        problemSummary: flags.problem,
        approach: flags.approach,
        result: flags.result,
        failureReason: flags.reason,
        environment: flags.environment,
        experienceId: flags.experience,
      });
      if (status !== 200) { console.error(`attempt record failed: ${data.error}`); process.exit(1); }
      console.log(`unsuccessful attempt ${data.id} recorded — future sessions retrieve it as a warning`);
      return;
    }
    case 'feedback': {
      const { flags, positional } = parseFlags(rest, new Set(['outcome', 'notes']));
      const id = positional[0];
      if (!id || !flags.outcome) { console.error('usage: knowledge feedback <EXP-ID> --outcome worked|failed|incompatible [--notes "..."]'); process.exit(1); }
      const { status, data } = await post('/knowledge/feedback', { experienceId: id, outcome: flags.outcome, notes: flags.notes });
      if (status !== 200) { console.error(`feedback failed: ${data.error}`); process.exit(1); }
      console.log(`reuse feedback recorded: ${flags.outcome}`);
      return;
    }
    case 'verify': {
      const { flags, positional } = parseFlags(rest, new Set(['check', 'version']));
      const id = positional[0];
      const checks = [].concat(flags.check ?? []).map((command) => ({ command }));
      if (!id || checks.length === 0) { console.error('usage: knowledge verify <EXP-ID> --check "<cmd>" [--check "<cmd>"]... [--version <n>]'); process.exit(1); }
      console.log(`running ${checks.length} verification check(s) on the workspace…`);
      const { status, data } = await post('/knowledge/verify', { id, checks, version: flags.version ? parseInt(flags.version, 10) : undefined });
      if (status !== 200) { console.error(`verify failed: ${data.error}`); process.exit(1); }
      for (const c of data.checks ?? []) {
        console.log(`  ${c.passed ? '✓' : '✗'} exit ${c.exitCode ?? 'n/a'}${c.timedOut ? ' (timed out)' : ''} — ${c.command}  [journal ${c.journalRef ?? '?'}]`);
      }
      console.log(`\n${data.id} v${data.version}: ${String(data.verificationStatus).toUpperCase()}${data.promoted ? ' → PROMOTED to verified' : ''}`);
      return;
    }
    case 'propose': {
      const { flags, positional } = parseFlags(rest, new Set(['solution', 'reason', 'symptoms', 'root-cause', 'environment', 'applicable', 'limitations', 'compatibility']))
      const id = positional[0];
      if (!id || !flags.solution || !flags.reason) { console.error('usage: knowledge propose <EXP-ID> --solution "..." --reason "..." [--compatibility "..."]'); process.exit(1); }
      const { status, data } = await post('/knowledge/propose', {
        id,
        solutionSteps: flags.solution,
        reason: flags.reason,
        symptoms: flags.symptoms,
        rootCause: flags['root-cause'],
        environment: flags.environment,
        applicableVersions: flags.applicable,
        limitations: flags.limitations,
        compatibilityNotes: flags.compatibility,
      });
      if (status !== 200) { console.error(`propose failed: ${data.error}`); process.exit(1); }
      console.log(`proposal stored as ${data.id} v${data.proposedVersion} — the active version stays trusted until this passes verification`);
      console.log(`next: knowledge verify ${data.id} --check "<cmd>" --version ${data.proposedVersion}`);
      return;
    }
    case 'sync': {
      const { data } = await post('/knowledge/sync', {});
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    default:
      console.error(`unknown knowledge subcommand "${sub}"` );
      console.error('try: knowledge [status] | search | read | submit | attempt | feedback | verify | propose | sync');
      process.exit(1);
  }
}

/* ---- verification subcommand helpers ---- */

const VSTATUS_GLYPH = {
  PENDING: '… pending', PLANNING: '✎ planning', READY: '⏸ ready (awaiting owner Start)',
  TESTING: '▶ testing', ANALYZING: '☰ analyzing', VERIFIED: '✔ verified',
  PARTIALLY_VERIFIED: '◐ partially verified', FAILED: '✗ failed', BLOCKED: '⊘ blocked',
};

async function readJsonArg(val, what) {
  if (!val) { console.error(`missing --json <file|-> (${what})`); process.exit(1); }
  const text = val === '-' ? await readStdin() : (await import('fs')).readFileSync(val, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`--json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

async function verificationCmd(sub, rest) {
  switch (sub) {
    case undefined:
    case 'status': {
      const { data } = await get('/verification');
      if (!data.ok) { console.error(data.error ?? 'verification store unavailable'); process.exit(1); }
      const c = data.counts;
      console.log(`verification store — ${data.online ? 'online' : 'OFFLINE (local cache)'} · ${c.total} run(s) · ${c.cases} case(s) · ${c.attempts} attempt(s) · ${c.evidence} evidence artifact(s)`);
      const bs = c.byStatus ?? {};
      console.log(`  verified ${bs.VERIFIED ?? 0} · partial ${bs.PARTIALLY_VERIFIED ?? 0} · failed ${bs.FAILED ?? 0} · blocked ${bs.BLOCKED ?? 0} · testing ${bs.TESTING ?? 0} · ready ${bs.READY ?? 0} · planning ${bs.PLANNING ?? 0}`);
      for (const r of data.runs ?? []) {
        const s = r.stats;
        console.log(`\n[${r.id}] ${r.title}  (${VSTATUS_GLYPH[r.status] ?? r.status} · ${r.knowledgeId} v${r.knowledgeVersion})`);
        console.log(`  stage ${r.currentStage}/10 ${r.stageName} · hypothesis: ${String(r.hypothesis).slice(0, 100)}`);
        console.log(`  stats: ${s.passed}✓ ${s.failed}✗ ${s.errors}⚠ of ${s.executed} executed (${s.attempts} attempts, ${s.iterations} round(s)) · pass rate ${s.passRate === null || s.passRate === undefined ? 'N/A' : s.passRate + '%'}`);
        if (r.conclusion) console.log(`  conclusion: ${r.conclusion.status} — ${r.conclusion.summary}`);
      }
      return;
    }
    case 'read': {
      const id = rest[0];
      if (!id) { console.error('usage: verification read <VRUN-ID>'); process.exit(1); }
      const { status, data } = await get(`/verification/run?id=${encodeURIComponent(id)}`);
      if (status !== 200) { console.error(data.error ?? 'not found'); process.exit(1); }
      console.log(JSON.stringify(data.detail, null, 2));
      return;
    }
    case 'create': {
      const { flags } = parseFlags(rest, new Set(['exp', 'json', 'version', 'title']));
      if (!flags.exp) { console.error('usage: verification create --exp <EXP-ID> --json <file|->'); process.exit(1); }
      const body = await readJsonArg(flags.json, 'problem + hypothesis + strategy');
      const { status, data } = await post('/verification/run', {
        knowledgeId: flags.exp,
        knowledgeVersion: flags.version ? parseInt(flags.version, 10) : undefined,
        title: flags.title,
        ...body,
      });
      if (status !== 200) { console.error(`create failed: ${data.error}`); process.exit(1); }
      console.log(`run ${data.run.id} created for ${flags.exp} v${data.run.knowledgeVersion} — observation + hypothesis recorded, environment captured from the real machine`);
      console.log(`next: verification plan ${data.run.id} --json plan.json`);
      return;
    }
    case 'plan': {
      const id = rest[0];
      const { flags } = parseFlags(rest, new Set(['json']));
      if (!id || !flags.json) { console.error('usage: verification plan <VRUN-ID> --json <file|->'); process.exit(1); }
      const body = await readJsonArg(flags.json, 'cases + experiments');
      const { status, data } = await post('/verification/plan', { runId: id, ...body });
      if (status !== 200) { console.error(`plan failed: ${data.error}`); process.exit(1); }
      console.log(`plan accepted — ${data.cases} case(s), run is READY${data.needsDangerousConfirm ? ' (⚠ contains network/destructive tests — owner must confirm at start)' : ''}`);
      if (data.refused?.length) console.log(`refused cases:\n  - ${data.refused.join('\n  - ')}`);
      console.log(`next: the owner reviews the plan on the dashboard and presses Start — or you start it: verification start ${id}`);
      return;
    }
    case 'start': {
      const id = rest[0];
      const { flags } = parseFlags(rest, new Set(['confirm-dangerous']));
      if (!id) { console.error('usage: verification start <VRUN-ID> [--confirm-dangerous]'); process.exit(1); }
      const { status, data } = await post('/verification/start', {
        runId: id,
        confirmDangerous: !!flags['confirm-dangerous'],
      });
      if (status !== 200) { console.error(`start failed: ${data.error}`); process.exit(1); }
      console.log(`execution started — ${data.note}`);
      console.log(`watch: verification read ${id}  (or the dashboard timeline — updates live)`);
      return;
    }
    case 'cancel': {
      const id = rest[0];
      const { flags } = parseFlags(rest, new Set(['reason']));
      if (!id) { console.error('usage: verification cancel <VRUN-ID> [--reason "..."]'); process.exit(1); }
      const { status, data } = await post('/verification/cancel', { runId: id, reason: flags.reason });
      if (status !== 200) { console.error(`cancel failed: ${data.error}`); process.exit(1); }
      console.log('cancel requested — takes effect before the next test starts');
      return;
    }
    case 'analyze': {
      const id = rest[0];
      const { flags } = parseFlags(rest, new Set(['json']));
      if (!id || !flags.json) { console.error('usage: verification analyze <VRUN-ID> --json <file|->'); process.exit(1); }
      const body = await readJsonArg(flags.json, 'analysis + proposedConclusion + metrics');
      const { status, data } = await post('/verification/analyze', { runId: id, ...body });
      if (status !== 200) { console.error(`analyze failed: ${data.error}`); process.exit(1); }
      const d = data.engineDecision;
      console.log(`analysis recorded — engine conclusion: ${data.effectiveStatus}${d.accepted ? '' : ` (⚠ GLM proposed otherwise — REJECTED by evidence: ${d.reason})`}`);
      if (data.rejectedMetrics?.length) console.log(`refused metrics (not in evidence):\n  - ${data.rejectedMetrics.join('\n  - ')}`);
      console.log(`next: verification regress ${id} --json reg.json   (another round)\n  or:  verification report ${id}              (finalize)`);
      return;
    }
    case 'regress': {
      const id = rest[0];
      const { flags } = parseFlags(rest, new Set(['json']));
      if (!id || !flags.json) { console.error('usage: verification regress <VRUN-ID> --json <file|->'); process.exit(1); }
      const body = await readJsonArg(flags.json, 'revised hypothesis + cases');
      const { status, data } = await post('/verification/regress', { runId: id, ...body });
      if (status !== 200) { console.error(`regress failed: ${data.error}`); process.exit(1); }
      console.log(`regression round ${data.round} added — ${data.status === 'READY' ? '⚠ waiting for owner confirmation (dangerous tests)' : 'executing now; previous rounds preserved'}`);
      return;
    }
    case 'report': {
      const id = rest[0];
      if (!id) { console.error('usage: verification report <VRUN-ID>'); process.exit(1); }
      const { status, data } = await post('/verification/report', { runId: id });
      if (status !== 200) { console.error(`report failed: ${data.error}`); process.exit(1); }
      console.log(`report generated — status ${data.reportStatus}`);
      console.log(`evidence: ${data.evidence.filename} (${data.evidence.bytes} bytes, sha256 ${data.evidence.sha256.slice(0, 16)}…) at ${data.evidence.storageRef}`);
      return;
    }
    case 'sync': {
      const { data } = await post('/verification/sync', {});
      console.log(JSON.stringify(data.counts ?? data, null, 2));
      return;
    }
    default:
      console.error(`unknown verification subcommand "${sub}"`);
      console.error('try: verification [status] | read | create | plan | start | cancel | analyze | regress | report | sync');
      process.exit(1);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) { usage(); process.exit(1); }

  switch (cmd) {
    case 'knowledge': {
      await knowledgeCmd(rest[0], rest.slice(1));
      return;
    }
    case 'verification': {
      await verificationCmd(rest[0], rest.slice(1));
      return;
    }
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
