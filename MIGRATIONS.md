# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

### 2026-02-11 — New `api_keys` table (FOO-329)

Added `api_keys` table for API key authentication. New table only — no existing data affected. Migration file: `drizzle/0011_eager_the_captain.sql`. Columns: id (serial PK), userId (FK to users.id), name, keyHash (unique), keyPrefix, lastUsedAt, revokedAt, createdAt.
