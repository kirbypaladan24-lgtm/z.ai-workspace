# Knowledge Store

This folder is the shared, persistent engineering knowledge base of the
Workspace Bridge ("Adaptive Intelligence" layer). It is plain JSONL —
portable with the repo, versioned by git, and human-readable.

| File              | Contents                                              |
|-------------------|-------------------------------------------------------|
| experiences.jsonl | One experience record per line (nested version array) |
| attempts.jsonl    | Unsuccessful attempts — negative retrieval signal     |
| feedback.jsonl    | Reuse feedback: worked / failed / incompatible        |
| audit.jsonl       | Append-only audit history (never edit or truncate)    |
| meta.json         | Schema version + ID counters (managed by the bridge)  |

Lifecycle: candidate -> verification_pending -> verified | rejected,
then deprecated / archived / soft-deleted by the owner. A record only
becomes "verified" through the bridge's verification gate (checks run by
the service with real exit codes) or explicit owner approval on the
dashboard. Failed attempts are never shown as solutions — only warnings.

Edit records on the dashboard (or via the bridge CLI). Avoid hand-editing
JSONL while the bridge is running; if you do, use "knowledge sync" after.
