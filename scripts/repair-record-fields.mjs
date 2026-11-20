#!/usr/bin/env node
/**
 * repair-record-fields.mjs — completes the v2 technical revision of
 * EXP-000008..012 for the records whose record-level corrections
 * (title / problemSummary) were swallowed when v2 was created.
 *
 * Root cause of the gap: the agent-service was still running the pre-revision
 * propose code when revise-knowledge.mjs first ran (the process had been
 * started without --hot, so the knowledge.ts extension never loaded). The
 * version-level v2 content stored correctly; the newly added record-level
 * title/problemSummary fields were ignored by the old code path.
 *
 * This script appends ONE completion proposal per affected record, carrying
 * the latest version's content forward unchanged and applying only the
 * record-level corrections. The original wording is preserved verbatim in the
 * new version's recordFieldChanges — nothing is overwritten.
 *
 * Idempotent: a record whose latest version already carries recordFieldChanges
 * is skipped, as is a record with no record-level targets (EXP-000012).
 *
 * Usage: node scripts/repair-record-fields.mjs   (targets the admin API on :3004)
 */

import { REVISIONS, EXPECT, LIMITS } from './revise-knowledge.mjs';

const API = process.env.BRIDGE_ADMIN ?? 'http://localhost:3004';

const CARRY_FORWARD_FIELDS = [
  'symptoms',
  'rootCause',
  'solutionSteps',
  'environment',
  'applicableVersions',
  'limitations',
  'compatibilityNotes',
];

const COMPLETION_REASON =
  'completes the preceding technical revision: applies the record-level title/problemSummary corrections that could not be processed when the previous version was created (the service was still running pre-revision propose code at that moment). Version content is carried forward unchanged; the original wording of the corrected record fields is preserved verbatim in recordFieldChanges.';

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function get(path) {
  const res = await fetch(API + path);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const { data: status } = await get('/knowledge');
  if (!status?.ok) {
    console.error('knowledge store unavailable:', status?.error ?? 'offline');
    process.exit(1);
  }
  if (!status.online) {
    console.error('knowledge store is OFFLINE — connect VS Code before repairing.');
    process.exit(1);
  }
  console.log(`knowledge store online · project: ${status.projectName}\n`);

  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  for (const rev of REVISIONS) {
    const targets = {
      ...(rev.propose.title ? { title: rev.propose.title } : {}),
      ...(rev.propose.problemSummary ? { problemSummary: rev.propose.problemSummary } : {}),
    };
    if (Object.keys(targets).length === 0) {
      console.log(`[skip] ${rev.id}: no record-level targets — nothing to repair`);
      skipped++;
      continue;
    }

    const { data: rec } = await get(`/knowledge/record?id=${rev.id}`);
    const record = rec?.record;
    if (!record) {
      console.error(`[fail] ${rev.id}: record not found`);
      failed++;
      continue;
    }
    const latest = record.versions.reduce((m, v) => (v.version > m.version ? v : m), record.versions[0]);
    if (latest.recordFieldChanges) {
      console.log(`[skip] ${rev.id}: latest version v${latest.version} already carries recordFieldChanges`);
      skipped++;
      continue;
    }
    if (!record.title.startsWith(EXPECT[rev.id])) {
      console.error(
        `[fail] ${rev.id}: identity mismatch — expected "${EXPECT[rev.id]}..." but found "${record.title.slice(0, 70)}..."`,
      );
      failed++;
      continue;
    }

    const proposal = {};
    for (const f of CARRY_FORWARD_FIELDS) proposal[f] = latest[f];
    Object.assign(proposal, targets);
    proposal.reason = COMPLETION_REASON;

    let tooLong = false;
    for (const [field, max] of Object.entries(LIMITS)) {
      const v = proposal[field];
      if (typeof v === 'string' && v.length > max) {
        console.error(`[fail] ${rev.id}: field "${field}" is ${v.length} chars (service limit ${max})`);
        tooLong = true;
      }
    }
    if (tooLong) {
      failed++;
      continue;
    }

    const { status: code, data } = await post('/knowledge/propose', { id: rev.id, ...proposal });
    if (code !== 200 || !data.ok) {
      console.error(`[fail] ${rev.id}: ${data.error ?? `HTTP ${code}`}`);
      failed++;
      continue;
    }

    // confirm the correction actually landed this time
    const { data: after } = await get(`/knowledge/record?id=${rev.id}`);
    const r2 = after?.record;
    const v2 = r2?.versions.find((v) => v.version === data.proposedVersion);
    const titleOk = targets.title ? r2.title === targets.title : true;
    const problemOk = targets.problemSummary ? r2.problemSummary === targets.problemSummary : true;
    const historyOk = v2?.recordFieldChanges?.title?.from === undefined
      ? true
      : v2.recordFieldChanges.title.from.length > 0;

    if (titleOk && problemOk && historyOk && r2.status === 'candidate' && r2.activeVersion === 1) {
      repaired++;
      const fields = Object.keys(targets).join(' + ');
      console.log(
        `[ ok ] ${rev.id}: v${data.proposedVersion} completion proposal — record-level ${fields} corrected,`,
      );
      console.log(`       originals preserved on v${data.proposedVersion}.recordFieldChanges; status "${r2.status}", active v${r2.activeVersion}`);
    } else {
      failed++;
      console.error(
        `[fail] ${rev.id}: proposal stored as v${data.proposedVersion} but post-checks failed (titleOk=${titleOk} problemOk=${problemOk} historyOk=${historyOk} status=${r2?.status} active=${r2?.activeVersion})`,
      );
    }
  }

  console.log(`\n${repaired} repaired · ${skipped} skipped · ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('repair run failed:', e);
  process.exit(1);
});
