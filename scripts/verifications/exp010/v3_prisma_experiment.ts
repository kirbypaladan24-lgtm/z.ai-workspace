/**
 * V3 (record plan, VM-sandbox experiment): count real Prisma queries for the
 * N+1 loop pattern vs findMany+include at TWO row counts (10 and 100) with
 * event-based query logging, and capture the ACTUAL SQL shape of include.
 *
 * ENVIRONMENT NOTE: this runs in the Z.ai sandbox VM (bun + Prisma 6.19.2),
 * NOT on the user's machine (no node there). It is supplementary evidence,
 * reported in the analysis of VRUN-000005 and labeled as sandbox-executed.
 */
import { PrismaClient } from '.prisma-n1-client';

const queries: string[] = [];
const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
});
(prisma as any).$on('query', (e: { query: string }) => {
  queries.push(e.query);
});

async function resetDb() {
  await prisma.$executeRawUnsafe('DELETE FROM Child');
  await prisma.$executeRawUnsafe('DELETE FROM Parent');
  try {
    await prisma.$executeRawUnsafe("DELETE FROM sqlite_sequence WHERE name IN ('Parent','Child')");
  } catch { /* sequence table absent until first insert */ }
}

async function seed(n: number) {
  await prisma.parent.createMany({
    data: Array.from({ length: n }, (_, i) => ({ name: `p${i}` })),
  });
  const parents = await prisma.parent.findMany({ select: { id: true } });
  await prisma.child.createMany({
    data: parents.flatMap((p) =>
      Array.from({ length: 3 }, (_, j) => ({ v: `c${p.id}-${j}`, parentId: p.id })),
    ),
  });
}

async function measure(n: number) {
  await resetDb();
  await seed(n);

  // --- N+1 loop pattern: one query for parents + one lazy relation query per row
  queries.length = 0;
  const parents = await prisma.parent.findMany();
  let seen = 0;
  for (const p of parents) {
    const kids = await prisma.child.findMany({ where: { parentId: p.id } });
    seen += kids.length;
  }
  const loopCount = queries.length;
  const loopFirstQueries = queries.slice(0, 2).map((s) => s.replace(/\s+/g, ' ').slice(0, 110));

  // --- batched read: findMany + include
  queries.length = 0;
  const rows = await prisma.parent.findMany({ include: { children: true } });
  const includeCount = queries.length;
  const includeQueries = queries.map((s) => s.replace(/\s+/g, ' ').slice(0, 200));
  const includeRows = rows.reduce((a, r) => a + r.children.length, 0);

  return { n, seen, loopCount, loopFirstQueries, includeCount, includeQueries, includeRows };
}

async function main() {
  const r10 = await measure(10);
  const r100 = await measure(100);

  console.log(`V3 Prisma version: 6.19.2 (Z.ai sandbox VM, bun) — supplementary evidence, NOT executed on the user's machine`);
  for (const r of [r10, r100]) {
    console.log(`\nV3 rows=${r.n}:`);
    console.log(`V3   loop pattern:   ${r.loopCount} queries (children seen: ${r.seen})`);
    console.log(`V3   include pattern: ${r.includeCount} query(ies) (children loaded: ${r.includeRows})`);
    console.log(`V3   loop first queries: ${JSON.stringify(r.loopFirstQueries)}`);
    console.log(`V3   include actual SQL: ${JSON.stringify(r.includeQueries)}`);
  }
  const grows = r100.loopCount > r10.loopCount;
  const constant = r100.includeCount === r10.includeCount;
  const linear = r100.loopCount - r100.includeCount > (r10.loopCount - r10.includeCount) * 5;
  console.log(`\nV3 verdict: loop query count grows with rows = ${grows} (${r10.loopCount} -> ${r100.loopCount}); include query count constant = ${constant} (${r10.includeCount} -> ${r100.includeCount})`);
  console.log(`V3 SQL shape of include on Prisma 6.19.2 + SQLite: ${r100.includeCount === 1 ? 'a single query' : `${r100.includeCount} queries`} — ${r100.includeCount === 1 ? 'compiles to one JOIN-style query' : 'multiple batched queries (NOT a single JOIN)'}`);
  const ok = grows && constant;
  console.log(ok ? 'V3-PRISMA-NPLUS1-CONFIRMED' : 'V3-FAILED');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('V3 experiment crashed:', e);
  process.exit(1);
});
