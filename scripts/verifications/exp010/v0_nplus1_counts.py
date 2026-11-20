import os, sqlite3, sys, tempfile, time

# V0 (record solutionSteps step 1/5): MEASURE FIRST — the N+1 pattern executes
# a query count that GROWS with row count; the batched read (one JOIN) executes
# a CONSTANT count. Real SQLite on the user's machine, temp dir (nothing is
# written into the workspace).

tmp = tempfile.mkdtemp(prefix='vrun5-n1-')
db = os.path.join(tmp, 'n1.db')
conn = sqlite3.connect(db)
conn.executescript('''
CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id), v TEXT);
''')
N = 500
conn.executemany('INSERT INTO parent VALUES (?,?)', [(i, f'p{i}') for i in range(1, N + 1)])
kids = [(i * 3 + j, i, f'c{i}-{j}') for i in range(1, N + 1) for j in range(3)]
conn.executemany('INSERT INTO child VALUES (?,?,?)', kids)
conn.commit()

counts = {'nplus1': 0, 'join': 0}

def run_nplus1():
    counts['nplus1'] += 1  # the parent query
    parents = conn.execute('SELECT id FROM parent').fetchall()
    for (pid,) in parents:
        rows = conn.execute('SELECT id, v FROM child WHERE parent_id = ?', (pid,)).fetchall()
        counts['nplus1'] += 1
        if not rows:
            raise RuntimeError('missing children')

def run_join():
    counts['join'] += 1
    rows = conn.execute('SELECT p.id, c.id, c.v FROM parent p JOIN child c ON c.parent_id = p.id').fetchall()
    if len(rows) != 3 * N:
        raise RuntimeError('join row count mismatch')

# warmup + timing (repeat each pattern once; counts are per-invocation)
t0 = time.perf_counter(); run_nplus1(); t_n1 = time.perf_counter() - t0
t0 = time.perf_counter(); run_join(); t_join = time.perf_counter() - t0

print(f"V0 rows: {N} parents x 3 children")
print(f"V0 N+1 loop pattern: {counts['nplus1']} queries, {t_n1 * 1000:.1f} ms")
print(f"V0 single JOIN:      {counts['join']} query,  {t_join * 1000:.1f} ms")
print(f"V0 query-count growth: loop = N+1 = {N + 1} (observed {counts['nplus1']}), join = 1 (observed {counts['join']})")

ok = counts['nplus1'] == N + 1 and counts['join'] == 1 and t_n1 > t_join
print(f"V0 latency: loop slower than join = {t_n1 > t_join} ({t_n1 / t_join:.1f}x)")
print("V0-NPLUS1-CONFIRMED" if ok else "V0-FAILED")
conn.close()
for f in os.listdir(tmp):
    os.remove(os.path.join(tmp, f))
os.rmdir(tmp)
sys.exit(0 if ok else 1)
