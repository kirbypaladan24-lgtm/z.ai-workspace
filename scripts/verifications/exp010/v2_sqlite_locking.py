import os, sqlite3, sys, tempfile, threading, time

# V2 (record plan, experimental): SQLite locking behavior on the user's machine.
#   Phase 1 (rollback journal, the default): writer B is blocked with
#     'database is locked' while writer A holds an open write transaction
#     (short busy timeout expires); after A commits, B succeeds.
#   Phase 2 (WAL mode): a READER proceeds while writer A holds an open write
#     transaction, while a second WRITER is still blocked — writers serialize
#     even in WAL; readers do not block writers.
# Everything in a temp dir; nothing is written into the workspace.

tmp = tempfile.mkdtemp(prefix='vrun5-lock-')
db = os.path.join(tmp, 'lock.db')
setup = sqlite3.connect(db)
setup.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
setup.execute("INSERT INTO t VALUES (1,'a')")
setup.commit()
journal_mode = setup.execute('PRAGMA journal_mode').fetchone()[0]
setup.close()
print(f"V2 default journal mode: {journal_mode}")
print(f"V2 sqlite library version: {sqlite3.sqlite_version}")

ok = True

# ---- Phase 1: rollback journal — concurrent writers serialize ----
A = sqlite3.connect(db, timeout=5)
A.execute('BEGIN IMMEDIATE')
A.execute("INSERT INTO t VALUES (2,'b')")  # A holds the write transaction (uncommitted)

result = {}
def writer_b_no_timeout():
    try:
        B = sqlite3.connect(db, timeout=0.25)
        B.execute("INSERT INTO t VALUES (3,'c')")
        result['short'] = 'unexpectedly-succeeded'
        B.commit(); B.close()
    except sqlite3.OperationalError as e:
        result['short'] = str(e)

th = threading.Thread(target=writer_b_no_timeout)
th.start(); th.join()
locked_error = 'locked' in result['short'].lower()
print(f"V2 phase1: writer B (0.25s busy timeout) while A holds write txn -> {result['short']!r}")
ok = ok and locked_error

# A commits -> the lock clears; B's retry with a real busy timeout succeeds
def writer_b_with_timeout(res):
    try:
        B = sqlite3.connect(db, timeout=3)
        B.execute("INSERT INTO t VALUES (3,'c')")
        B.commit(); B.close()
        res['long'] = 'ok'
    except sqlite3.OperationalError as e:
        res['long'] = str(e)

res2 = {}
th2 = threading.Thread(target=writer_b_with_timeout, args=(res2,))
th2.start()
time.sleep(0.4)  # B is waiting on the busy handler
A.commit()       # A releases the write lock
th2.join()
print(f"V2 phase1: writer B (3s busy timeout) succeeds after A commits -> {res2['long']!r}")
ok = ok and res2['long'] == 'ok'
A.close()

# ---- Phase 2: WAL mode — readers proceed, writers still serialize ----
W = sqlite3.connect(db, timeout=5)
wal_mode = W.execute('PRAGMA journal_mode=WAL').fetchone()[0]
print(f"V2 phase2: journal_mode set to {wal_mode}")
W.execute('BEGIN IMMEDIATE')
W.execute("INSERT INTO t VALUES (4,'d')")  # pending write, uncommitted

res3 = {}
def reader():
    try:
        R = sqlite3.connect(db, timeout=1)
        rows = R.execute('SELECT COUNT(*) FROM t').fetchone()[0]
        res3['reader'] = f'ok rows={rows}'
        R.close()
    except sqlite3.OperationalError as e:
        res3['reader'] = str(e)

def writer_c():
    try:
        C = sqlite3.connect(db, timeout=0.25)
        C.execute("INSERT INTO t VALUES (5,'e')")
        res3['writer'] = 'unexpectedly-succeeded'
        C.commit(); C.close()
    except sqlite3.OperationalError as e:
        res3['writer'] = str(e)

t1 = threading.Thread(target=reader)
t2 = threading.Thread(target=writer_c)
t1.start(); t2.start(); t1.join(); t2.join()
reader_ok = res3['reader'].startswith('ok')
writer_blocked = 'locked' in res3['writer'].lower()
print(f"V2 phase2: reader during pending write -> {res3['reader']!r}")
print(f"V2 phase2: second writer during pending write -> {res3['writer']!r}")
ok = ok and wal_mode.lower() == 'wal' and reader_ok and writer_blocked
W.commit(); W.close()

print("V2-SQLITE-LOCK-CONFIRMED" if ok else "V2-FAILED")
for f in os.listdir(tmp):
    os.remove(os.path.join(tmp, f))
os.rmdir(tmp)
sys.exit(0 if ok else 1)
