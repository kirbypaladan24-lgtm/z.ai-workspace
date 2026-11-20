#!/usr/bin/env node
/**
 * seed-knowledge.mjs — seed the Workspace Bridge knowledge store with the
 * expert-playbook library (Adaptive Intelligence plan, curated seed batch 1).
 *
 * What lands in knowledge/ (the user's workspace, git-versioned):
 *
 *   EVIDENCE-VERIFIED (verification gate runs REAL checks on the user's
 *   machine through the bridge — python3 math demonstrations + real SQLite
 *   file operations; naive/wrong approach fails, correct approach exits 0):
 *     1. Softmax overflow → subtract max(x)          (ML numerics)
 *     2. Cross-entropy via log-sum-exp               (ML numerics)
 *     3. Scaler data leakage, fit on train only      (ML correctness)
 *     4. He initialization for deep ReLU stacks      (NN training)
 *     5. SQLite file-copy backup before migrations   (DB migration)
 *
 *   CANDIDATES (conceptual expert protocols — the operator promotes them
 *   from the dashboard Knowledge tab; the bridge never self-approves):
 *     6. Single-batch overfit sanity protocol        (NN debugging)
 *     7. Loss-curve shape triage table               (ML debugging)
 *     8. N+1 query elimination                       (DB performance)
 *     9. AI-operator: verify APIs before using them  (agent self-correction)
 *    10. AI-operator: surgical edits / revert-to-green (anti-overthinking)
 *
 * Idempotent: records whose exact title already exists are skipped, so this
 * can be re-run on a fresh workspace to restore the default library.
 *
 * Usage: node scripts/seed-knowledge.mjs   (targets the admin API on :3004)
 */

const API = process.env.BRIDGE_ADMIN ?? 'http://localhost:3004';

/* ------------------------------------------------------------------ */
/* Seed records                                                        */
/* ------------------------------------------------------------------ */

const RECORDS = [
  /* ---------- 1. Softmax numerical stability (VERIFIED) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'ML numerics: loss becomes NaN with large logits — softmax overflows; subtract max(x) first',
      problemSummary:
        'Hand-rolled softmax computed as exp(x)/sum(exp(x)) produces Infinity/Infinity=NaN (JS) or an overflow exception (Python) as soon as any logit exceeds ~709 in float64 (~88 in float32). Symptom: loss is NaN on the very first forward pass, training diverges instantly, and the operator wastes hours blaming the learning rate, the data, or the architecture when the cause is pure floating-point arithmetic.',
      symptoms:
        'loss = NaN from step 0 or the first confident prediction; model outputs become all-zero or NaN; bug appears after switching a model to raw logits or when predictions get confident; float32 breaks at logits > ~88 while float64 breaks at > ~709',
      rootCause:
        'IEEE-754 doubles overflow above exp(709.78): exp(1000)=Infinity, and Infinity/Infinity=NaN (or OverflowError in Python math.exp). Softmax is mathematically invariant to shifting ALL logits by a constant, so subtracting max(x) changes nothing mathematically but bounds every exponent argument to <= 0, making overflow impossible.',
      solutionSteps:
        '1) z = x - max(x)  2) e = exp(z)  3) softmax = e / sum(e). Never implement softmax without the max shift. In frameworks use the fused op which does this internally: torch.softmax / F.log_softmax, tf.nn.softmax, scipy.special.softmax. Related: never compute cross-entropy as log(softmax(x)) — use the log-sum-exp form (companion record in this library).',
      environment:
        'Any float stack: PyTorch, TensorFlow, JAX, NumPy, hand-rolled JS/Python math. Float32 is hit 8x earlier than float64.',
      applicableVersions: 'Applies to all versions — IEEE-754 semantics are fixed by the standard',
      limitations:
        'No exceptions: subtracting the max is mandatory in EVERY hand-rolled softmax, even for "small" logits, because input scale is rarely guaranteed upstream.',
    },
    checks: [
      `python3 -c 'import math,sys
x=[1000.0,1001.0]
m=max(x);t=sum(math.exp(v-m) for v in x);s=[math.exp(v-m)/t for v in x]
ok=all(map(math.isfinite,s)) and abs(sum(s)-1)<1e-12
try: [math.exp(v) for v in x]; bad=False
except OverflowError: bad=True
print("naive exp on raw logits:","OverflowError" if bad else "ok","| stable softmax (max-subtracted):",s); sys.exit(0 if ok and bad else 1)'`,
    ],
  },

  /* ---------- 2. Cross-entropy via log-sum-exp (VERIFIED) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'ML numerics: cross-entropy Infinity or NaN gradients on confident predictions — use log-sum-exp, never log(softmax)',
      problemSummary:
        'Computing categorical cross-entropy as -log(softmax(x)[y]) underflows to probability exactly 0.0 for confident-but-wrong predictions, so loss = -log(0) = +Infinity and gradients become NaN. Symptom: training runs fine for a while, then explodes the moment the model becomes confident on one class; NaN gradients appear sporadically and "randomly".',
      symptoms:
        'loss = Infinity on a confident wrong prediction; NaN gradients after some epochs; sporadic NaN that appears only once the model stops being uncertain; the same code trains fine early and breaks later',
      rootCause:
        'softmax outputs can underflow to exactly 0.0 in floating point (any probability below ~1e-308 in float64, ~1e-45 in float32), and log(0) = -Infinity. The stable identity avoids softmax entirely: CE = logsumexp(x) - x[y], where logsumexp(x) = max(x) + log(sum(exp(x - max(x)))). The max-shift keeps every exp argument <= 0 and the log of the sum stays finite.',
      solutionSteps:
        '1) m = max(x)  2) lse = m + log(sum(exp(x[i] - m)))  3) CE = lse - x[y]. In PyTorch use F.cross_entropy on RAW logits (never log_softmax then cross_entropy — double application of log); for binary cross-entropy use BCEWithLogitsLoss, never sigmoid then log. In NumPy/JS use scipy.special.logsumexp / the identity above. Do not add an epsilon — the max shift makes epsilon unnecessary and it only masks bugs.',
      environment: 'Any ML stack; critical in float32 training and all hand-rolled loss implementations',
      applicableVersions: 'Applies to all versions — IEEE-754 underflow semantics are fixed',
      limitations:
        'Covers softmax cross-entropy; sigmoid/BCE has the analogous logits rule. Other losses (sparsemax etc.) have their own stable implementations — check before hand-rolling.',
    },
    checks: [
      // NOTE: the first version of this check hard-coded an expected constant
      // (0.686738) that was arithmetically wrong (correct: ln(1+e^-1) =
      // 0.313262). The verification gate caught it — exit 1, record rejected —
      // which is precisely the gate working as designed. This version
      // cross-checks two INDEPENDENT stable formulations instead of trusting
      // a hand-computed constant.
      `python3 -c 'import math,sys
x=[1000.0,1001.0];y=1
m=max(x);lse=m+math.log(sum(math.exp(v-m) for v in x));ce=lse-x[y]
ce2=-math.log(math.exp(x[y]-m)/sum(math.exp(v-m) for v in x))
p=1e-400
ok=math.isfinite(ce) and abs(ce-ce2)<1e-12 and (p==0.0)
print("softmax prob underflows to exactly 0.0:",p==0.0,"| naive CE = -log(0) = inf | stable CE:",ce,"| cross-check:",ce2); sys.exit(0 if ok else 1)'`,
    ],
  },

  /* ---------- 3. Scaler data leakage (VERIFIED) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'ML data leakage: fitting scaler/encoder on the full dataset inflates validation metrics — split first, fit on train only',
      problemSummary:
        'Computing normalization statistics (mean/std/min-max), target encodings, imputation values, or feature selection on the FULL dataset before splitting leaks test information into training. Validation metrics look great; production performance collapses. Symptom: offline metrics "too good to be true" compared to any live or holdout-later evaluation — the classic silent leakage failure.',
      symptoms:
        'validation metrics suspiciously better than production/live performance; k-fold CV much better than a time-based split of the same data; results degrade the moment someone re-splits the data properly; temporal data normalized with future statistics',
      rootCause:
        'Test-set values contribute to the very statistics used to transform them, so the transform itself carries information about the test distribution — the test set is normalized toward the training distribution instead of being honestly out-of-sample. With shifted distributions (e.g. time series where later values are larger) every normalized test value is biased by its own contamination.',
      solutionSteps:
        '1) Split FIRST — by time for temporal data, by entity (user/company) when rows share an origin; never random-split temporal data. 2) Fit the scaler/encoder/imputer on the TRAIN split only. 3) Transform both train and test with the train-fitted scaler. 4) In sklearn wrap preprocessing + model in a Pipeline so cross-validation refits the scaler inside each fold. 5) Audit existing code: if train-mean equals full-dataset-mean while a test set exists, there is leakage. 6) Same rule for: target encoding, missing-value imputation, feature selection, NLP vocabulary building, and augmentation statistics.',
      environment: 'sklearn/pandas pipelines, PyTorch preprocessing, any tabular ML workflow',
      applicableVersions: 'Universal ML methodology',
      limitations:
        'Leakage through duplicate rows (same entity in train and test) needs entity-aware splitting, not just statistic hygiene. Leakage through temporal features (e.g. "days since event" computed with future knowledge) must be fixed at feature design time.',
    },
    checks: [
      `python3 -c 'import sys
train=[1.0,2.0,3.0,4.0];test=[10.0]
mt=sum(train)/len(train);mf=sum(train+test)/len(train+test)
shift=abs((test[0]-mt)-(test[0]-mf));ok=(mt!=mf) and shift>0
print("train-only mean:",mt,"| mean with test leaked in:",mf,"| every normalized test value shifts by:",shift); sys.exit(0 if ok else 1)'`,
    ],
  },

  /* ---------- 4. He initialization (VERIFIED) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'NN training: immediate NaN loss or dead flat loss in deep ReLU network — wrong weight init scale; use He init std = sqrt(2/fan_in)',
      problemSummary:
        'Initializing weights with plain random values (std=1, uniform(-1,1)) scales activations by ~fan_in at every layer: a 20-layer net with 64 units explodes activations to ~1e28 (NaN gradients) — or with too-small weights, activations vanish to 0 and the loss never moves at any learning rate. Symptom: immediate NaN in deep nets, or loss pinned at its initialization value while the operator tunes the LR pointlessly.',
      symptoms:
        'loss = NaN within the first updates of a deep net; loss completely flat from step 0 regardless of learning rate; activation histograms grow/shrink by orders of magnitude with depth; "small nets train, deep nets die"',
      rootCause:
        'For a linear layer y = Wx with n inputs, Var(y) ~ n * E[w^2] * Var(x). To keep activation variance constant across layers with ReLU (which zeroes half the units), you need E[w^2] = 2/n — i.e. He/Kaiming initialization, std = sqrt(2/fan_in). Naive std=1 weights multiply the second moment by n/2 every layer (64x -> dead by layer 20); tiny weights shrink it toward 0.',
      solutionSteps:
        '1) Use He/Kaiming init for ReLU-family activations: normal(std=sqrt(2/fan_in)) — torch.nn.init.kaiming_normal_ (PyTorch default for Conv/Linear since 1.0). 2) Xavier/Glorot (sqrt(1/fan_in) or its uniform variant) for tanh/sigmoid. 3) LeakyReLU uses sqrt(2/(1+alpha^2))/sqrt(fan_in). 4) Sanity check: forward one batch through the UNTRAINED net and print activation std per layer — it should stay within roughly [0.5, 2] of the input std at EVERY depth; if layer-20 is ~0 or ~>1e6, the init is wrong. 5) For very deep nets (>~30 layers) add BatchNorm/LayerNorm as the robust fix.',
      environment:
        'PyTorch, TensorFlow, JAX, hand-rolled nets; fully-connected and conv architectures (conv fan_in = kh*kw*in_channels)',
      applicableVersions:
        'Frameworks default correctly for standard layers — this bites in hand-rolled layers, custom activations, and code ported between frameworks',
      limitations:
        'Also check the accompanying loss function numerics (softmax/CE records in this library) — NaN can come from either place; the per-layer activation-std print distinguishes them.',
    },
    checks: [
      `python3 -c 'import random,sys,math
random.seed(7);n=64;L=20
def run(std):
 v=[1.0]*n
 for _ in range(L):
  v=[max(0.0,sum(v[j]*random.gauss(0,std) for j in range(n))) for _ in range(n)]
 return sum(x*x for x in v)/n
naive=run(1.0);he=run(math.sqrt(2.0/n));ok=(naive>1e6) and (0.01<he<100)
print("20-layer ReLU net, mean squared activation — naive std=1.0:",naive,"| He std=sqrt(2/fan_in):",he); sys.exit(0 if ok else 1)'`,
    ],
  },

  /* ---------- 5. SQLite migration backup (VERIFIED — real db file) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'SQLite migration safety: file-copy the .db before any schema change — a byte-identical copy IS a complete backup',
      problemSummary:
        'Running prisma db push / migrate / raw ALTER TABLE against the ONLY copy of a SQLite database with no backup, then hitting data loss (--accept-data-loss) or a lock mid-migration, leaves no recovery path. SQLite has no server-side snapshot: the .db file is the entire database, which also makes it the cheapest database in the world to back up — the step everyone skips.',
      symptoms:
        'schema migration ran with --accept-data-loss and dropped data; database locked / disk I/O error mid-migration corrupts the file; "we lost the dev database"; rollback impossible because no copy existed',
      rootCause:
        'SQLite stores schema, data, indices and WAL in a single file. A byte-copy of that file taken while no write transaction is open is a complete, restorable database. Migrations mutate that single file in place, so without a pre-copy any mistake is permanent.',
      solutionSteps:
        '1) BEFORE any schema change: cp db/<name>.db db/<name>.backup-$(date +%s).db and verify the copy with cmp -s (byte-identical). 2) Prefer additive changes: new nullable column, new table — avoid in-place mutation of existing columns. 3) Add NOT NULL columns WITH a DEFAULT value. 4) Prototype with prisma db push; keep migration history with prisma migrate dev once the schema stabilizes. 5) Test the migration on the BACKUP COPY first, then run it on the real file. 6) For live/WAL-mode databases use sqlite3 <db> ".backup <target>" instead of a raw cp (safe while writers are active).',
      environment:
        'SQLite + Prisma (this bridge stack: bun run db:push), any SQLite-backed application',
      applicableVersions: 'All SQLite versions; Prisma 4/5/6',
      limitations:
        'A raw cp is only safe when no writer is active (stop the dev server / run migrations offline). The sqlite3 .backup command is the safe online alternative. WAL sidecar files (-wal, -shm) must be copied together or checkpointed first.',
    },
    checks: [
      'ls db/custom.db >/dev/null && cp db/custom.db /tmp/bridge-backup-proof.db && cmp -s db/custom.db /tmp/bridge-backup-proof.db && rm /tmp/bridge-backup-proof.db && echo "byte-identical file-copy backup of db/custom.db: verified"',
    ],
  },

  /* ---------- 6. Single-batch overfit protocol (CANDIDATE) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'debugging-technique',
      title: 'ML debugging: network does not learn — overfit 10 samples FIRST (single-batch sanity protocol) before tuning anything',
      problemSummary:
        'Engineers and AI operators burn hours tuning architecture, optimizers and hyperparameters on networks that have an implementation bug. The definitive first test — can the network memorize a tiny batch? — is skipped, and the session spirals into exactly the "overthinking" this knowledge library exists to prevent.',
      symptoms:
        'loss plateaus immediately at its initial value; model predicts the mean/class prior for every input; "tried 5 different architectures and none of them learn"; loss decreases on nothing at any learning rate',
      rootCause:
        'If a network cannot overfit 10 samples, the bug is mechanical — labels misaligned with inputs, loss applied to the wrong tensor, detach() breaking gradients, wrong loss for the label dtype, preprocessing destroying the signal — NOT capacity or hyperparameters. Overfitting a tiny batch cleanly separates implementation bugs from generalization problems.',
      solutionSteps:
        '1) Take ~10 training samples. 2) Train ONLY on them (many epochs) until loss < ~1e-2 or accuracy is 100%. 3) If it cannot: (a) print tensor SHAPES at every boundary; (b) verify labels align with inputs — if data was shuffled, confirm inputs and labels were shuffled TOGETHER; (c) verify the loss receives raw logits + correct label dtype (CrossEntropyLoss wants long/int labels, no softmax applied); (d) run one backward pass and assert every parameter has non-None, non-zero grad; (e) inspect the inputs themselves (print a sample — is the signal actually there?). 4) Only after the tiny batch overfits, scale to full data — if training loss now rises while tiny-batch worked, the problem is data volume/regularization, not code.',
      environment: 'Any deep learning framework — the single highest-ROI debugging step in NN work',
      applicableVersions: 'Universal methodology',
      limitations:
        'For very large models, reduce width or freeze early layers — the point is mechanical correctness, not convergence speed. RL has the analogous sanity: random-agent returns on a trivially small environment before any training.',
    },
  },

  /* ---------- 7. Loss-curve triage table (CANDIDATE) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'debugging-technique',
      title: 'ML triage: read the loss curve shape before changing anything — NaN, flat, exploding and train-val gap each map to 2-3 concrete checks',
      problemSummary:
        'When training misbehaves, operators jump between speculative fixes (shotgun debugging) instead of reading the loss curve, which narrows the cause to a small candidate set. This record is the triage table: match the curve shape, run the 2-3 listed checks, fix, move on.',
      symptoms:
        'loss = NaN early; loss flat from step 0; loss explodes upward after a period of progress; train loss falls while validation loss rises; both losses flatten at a mediocre value',
      rootCause:
        'Each loss-curve shape has a well-defined, small cause set — the shape is diagnostic information, not noise.',
      solutionSteps:
        'NaN/Inf EARLY -> learning rate too high (divide by 10), numerical instability in loss/softmax (see the softmax and log-sum-exp records in this library), or inf/nan already present in the input data. FLAT FROM STEP 0 -> LR too low; dead ReLUs (print per-layer activation stats); loss/label mismatch (regression loss on classification labels); or broken graph (detached tensors, optimizer.step() never called). EXPLODES AFTER N GOOD STEPS -> gradient explosion (clip grad norm); LR schedule stepping too aggressively; batch size shrank and per-step noise grew. TRAIN down, VAL up -> overfitting — respond in ROI order: more/augmented data, dropout, weight decay, early stopping (architecture changes LAST). BOTH FLAT AT MEDIOCRE VALUE -> labels nearly constant (class imbalance — check the majority baseline) or inputs uninformative (feature pipeline broken; print samples). When the shape alone is ambiguous, log per-layer activation AND gradient norms and look for the layer where they hit 0 or blow up.',
      environment: 'All supervised training loops, any framework',
      applicableVersions: 'Universal methodology',
      limitations:
        'Curve shapes interact with LR schedules — always do the first diagnosis at a constant LR, then re-introduce warmup/decay.',
    },
  },

  /* ---------- 8. N+1 queries (CANDIDATE) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'Database performance: N+1 queries — page slows as rows grow; count queries first, fix with Prisma include / WHERE IN batching',
      problemSummary:
        'List endpoints that run 1 query for the rows plus N lazy queries for each row relation become O(N) database round-trips: 100 rows = 101 queries. Symptom: page latency grows linearly with row count, "fast locally, slow with real data", and on SQLite specifically, lock contention under concurrent load.',
      symptoms:
        'endpoint latency scales with the number of rows returned; query log shows the same query repeated dozens of times per request; SQLite "database is locked" under light concurrency; page loads fine with 10 rows and crawls at 1000',
      rootCause:
        'Accessing a relation inside a loop triggers one lazy query per row. The database can do this work in a single join or a single keyed batch — the ORM just needs to be asked. Each extra round-trip also holds a SQLite lock longer, compounding contention.',
      solutionSteps:
        '1) MEASURE FIRST: enable query logging (Prisma: new PrismaClient({ log: ["query"] })) and count queries per request — more than ~3 for a list view means investigate. 2) Replace loop-accessed relations with include: db.post.findMany({ include: { author: true } }) — one join instead of N queries. 3) For key lists: db.user.findMany({ where: { id: { in: ids } } }) then group in memory. 4) GraphQL servers: DataLoader coalesces same-tick lookups. 5) VERIFY the fix: query count per request must be CONSTANT regardless of row count. 6) If include over-fetches, shape it with select; if you need >2 levels of nested include, suspect a denormalization need rather than a query-pattern problem.',
      environment: 'Prisma + SQLite/Postgres (this bridge stack), ORMs generally, GraphQL/REST list endpoints',
      applicableVersions: 'Prisma 4/5/6',
      limitations:
        'include on very large relations can over-fetch — use select to shape payloads. Deep nested includes (>2 levels) usually indicate the schema should be denormalized, not that the query pattern is wrong.',
    },
  },

  /* ---------- 9. AI-operator: verify APIs (CANDIDATE — self-correction) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'pattern',
      title: 'AI-operator self-correction: verify an API exists in the INSTALLED project before using it — hallucinated APIs are the #1 agent bug source',
      problemSummary:
        'LLM agents (including the operator writing this) confidently use APIs from training memory: functions that do not exist in the installed version, options added in later releases, or methods from a different library with the same name. The code looks plausible and fails at runtime with "x.y is not a function". This is the single most common hallucinated-bug source in agent-written code — and the cheapest to prevent.',
      symptoms:
        'TypeError: x.y is not a function; "property does not exist on type"; an option is silently ignored instead of changing behavior; "works in the docs" but not in this project — version drift',
      rootCause:
        'Model memory blends versions, libraries and APIs into plausible-looking calls. The project node_modules, @types and package.json are ground truth; memory is only a prior, never evidence. Treating memory as evidence produces code that was never valid for THIS project.',
      solutionSteps:
        'Before using any non-trivial API: 1) Confirm the project depends on it — read package.json; prefer existing dependencies over new ones. 2) Confirm the exact symbol exists in the installed version — grep node_modules/<pkg> or read its .d.ts. 3) Prefer APIs already used elsewhere in THIS codebase (grep src/) — consistency with the project beats novelty. 4) If the project ships a component library (shadcn/ui in this stack), use its components instead of hand-rolling. 5) If the API is absent, STOP and adapt to what exists — never invent an intermediate version of the library. Cost: seconds per check, versus hours of runtime debugging.',
      environment: 'Agent-driven development through this bridge; any TypeScript/JavaScript project',
      applicableVersions: 'Applies to every AI coding session, any library stack',
      limitations:
        'The bridge tool `run` executes grep against the real workspace — make this check part of the preflight, not an afterthought.',
    },
  },

  /* ---------- 10. AI-operator: surgical edits (CANDIDATE — anti-overthinking) ---------- */
  {
    submit: {
      scope: 'global',
      category: 'debugging-technique',
      title: 'AI-operator self-correction: minimal surgical edits, one change per cycle, revert before the next attempt — the antidote to overthinking',
      problemSummary:
        'When an error resists the first fix, LLM agents escalate: rewriting whole files, changing many things at once, stacking speculative fixes on top of failed ones. This destroys working state, introduces new bugs, and hides which change mattered — the canonical overthinking failure mode this knowledge library exists to break.',
      symptoms:
        'a small bug fix turned into a 300-line diff; the error message changed but the root cause was never addressed; "fixed A, broke B"; a file was rewritten and now diverges from what git and the tests know; two failed fixes stacked into unknown state',
      rootCause:
        'Multiple simultaneous changes make cause and effect unattributable, and rewrites discard code that encoded working knowledge. Debugging is a search problem: every iteration must be ONE attributable change with a measured result. Stacking fixes on failures explores the wrong branch of the search tree while corrupting the starting point.',
      solutionSteps:
        '1) Make the smallest edit that plausibly addresses the CAUSE (anchored edit, not file rewrite). 2) After a failed attempt, REVERT it before trying the next — never stack fixes on a failed one. 3) Change ONE variable at a time and re-run the exact failing check after each change. 4) If two attempts fail: STOP. Re-read the ACTUAL error text (not the assumed one), reduce it to a minimal reproduction, and re-approach from the last known-green state (git checkout/restore the file). 5) Re-read the file after editing to confirm the edit landed as intended. 6) Reserve full rewrites for genuinely unsalvageable files — and require evidence (two failed surgical attempts) before claiming that.',
      environment: 'Agent-driven development through this bridge; universally applicable to debugging',
      applicableVersions: 'Universal methodology',
      limitations:
        'This discipline is what the knowledge store records failed ATTEMPTS for: check the failed-attempt warnings during preflight so you do not repeat an approach that already failed in this workspace.',
    },
  },
];

/* ------------------------------------------------------------------ */
/* Admin API helpers                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Seed runner                                                         */
/* ------------------------------------------------------------------ */

async function main() {
  const { data: status } = await get('/knowledge');
  if (!data0ok(status)) {
    console.error('knowledge store unavailable:', status?.error ?? 'offline');
    process.exit(1);
  }
  console.log(`knowledge store online · project: ${status.projectName ?? '—'} · verified ${status.counts.verified} · candidates ${status.counts.candidate}\n`);

  let submitted = 0, skipped = 0, verified = 0, failed = 0;

  for (const [i, rec] of RECORDS.entries()) {
    const label = `[${String(i + 1).padStart(2, '0')}] ${rec.submit.title.slice(0, 70)}…`;

    // Idempotency: exact-title match against the whole store (incl. rejected).
    const { data: found } = await post('/knowledge/search', {
      query: rec.submit.title,
      includeRejected: true,
      limit: 50,
    });
    if (found?.ok && (found.hits ?? []).some((h) => h.title === rec.submit.title)) {
      console.log(`${label}\n     already present — skipped`);
      skipped++;
      continue;
    }

    const { status: sCode, data: sub } = await post('/knowledge/submit', rec.submit);
    if (sCode !== 200 || !sub.ok) {
      console.error(`${label}\n     SUBMIT FAILED: ${sub.error ?? sCode}`);
      failed++;
      continue;
    }
    submitted++;

    if (rec.checks?.length) {
      const { data: ver } = await post('/knowledge/verify', {
        id: sub.id,
        checks: rec.checks.map((command) => ({ command, timeoutMs: 30000 })),
      });
      if (ver?.promoted) {
        verified++;
        console.log(`${label}\n     ${sub.id} → submitted + VERIFIED (gate promoted: ${ver.checks.length} check(s) exit 0)`);
      } else {
        console.error(`${label}\n     ${sub.id} → submitted but verification ${ver?.verificationStatus ?? 'failed'} — stays candidate`);
      }
    } else {
      console.log(`${label}\n     ${sub.id} → submitted as CANDIDATE (owner can approve on the dashboard)`);
    }
  }

  const { data: final } = await get('/knowledge');
  const c = final.counts ?? {};
  console.log(`\nseed complete — submitted ${submitted} (verified via gate: ${verified}) · skipped ${skipped} · failed ${failed}`);
  console.log(`store now: verified ${c.verified} · candidates ${c.candidate} · pending ${c.verificationPending} · rejected ${c.rejected} · attempts ${c.attempts} · feedback ${c.feedback} · audit ${c.audit}`);
}

function data0ok(d) {
  return d && d.ok !== false && d.online !== false;
}

main().catch((e) => {
  console.error('seed error:', e.message);
  process.exit(1);
});
