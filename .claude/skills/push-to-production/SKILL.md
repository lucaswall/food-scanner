---
name: push-to-production
description: Promote main to release with production DB backup and migration handling. Use when user says "push to production", "release", "deploy to production", or "promote to release". Backs up production DB, assesses MIGRATIONS.md, writes migration code if needed, and merges main to release.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task
disable-model-invocation: true
---

Promote `main` to `release` with automated backup, migration assessment, and merge. This is the only path to production.

## Phase 1: Pre-flight Checks

### 1.1 Git State

```bash
git branch --show-current
git status --porcelain
```

**Requirements:**
- Must be on `main` branch
- Working tree must be clean (no uncommitted changes)
- Must be up to date with remote: `git fetch origin && git rev-list --count HEAD..origin/main` must be `0`

If any check fails, **STOP** and tell the user what to fix.

### 1.2 Docker (OrbStack)

Ensure OrbStack and Docker are available for migration validation:

```bash
orb status
```

- If **Running**: proceed
- If **Stopped**: start it with `orb start`, then verify with `docker compose ps`
- If `orb` command not found: **STOP** — "OrbStack is not installed. Install with `brew install orbstack`."

Then ensure local Postgres is running:

```bash
docker compose ps
```

If the `db` service is not running, start it: `docker compose up -d`

### 1.3 Verify Drizzle Migration Internals

Only needed if MIGRATIONS.md has entries (checked later in Phase 3, but verify early to fail fast). Read the Drizzle migrator source from the exact version in `node_modules` and confirm our assumptions about the journal table still hold:

```bash
# Check migrator comparison logic
grep -q '"drizzle"."__drizzle_migrations"' node_modules/drizzle-orm/pg-proxy/migrator.js
grep -q 'ORDER BY created_at DESC LIMIT 1' node_modules/drizzle-orm/pg-proxy/migrator.js
grep -q 'created_at' node_modules/drizzle-orm/pg-proxy/migrator.js

# Check hash algorithm
grep -q 'createHash("sha256")' node_modules/drizzle-orm/migrator.js
```

All four must match. If any fails, **STOP**: "Drizzle migration internals have changed since this skill was written. The journal insert approach may not work. Check `node_modules/drizzle-orm/pg-proxy/migrator.js` manually and update the skill."

This verification is safe because we deploy the same `node_modules` — the code we check here is the code that will run in production.

### 1.4 Build & Tests

Run the `verifier` agent to confirm build and tests pass:

```
Use Task tool with subagent_type "verifier"
```

If verifier reports failures, **STOP**. Do not proceed with a broken build.

### 1.5 Release Branch Exists

```bash
git rev-parse --verify origin/release
```

If `release` branch doesn't exist, **STOP** and tell the user to create it.

### 1.6 Diff Assessment

Check what's changing between `release` and `main`:

```bash
git log origin/release..origin/main --oneline
git diff origin/release..origin/main --stat
```

If there are no commits to promote, **STOP**: "Nothing to promote. `main` and `release` are identical."

Show the user the commit list and file diff summary.

## Phase 2: Backup Production Database

### 2.1 Create Backup Directory

```bash
mkdir -p _migrations
```

### 2.2 Get Production Database URL

```bash
railway run -e production -s food-scanner printenv DATABASE_PUBLIC_URL
```

If the command fails or returns empty, **STOP**: "Cannot connect to production database. Check Railway configuration and DATABASE_PUBLIC_URL variable."

### 2.3 Dump Production Database

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "$DATABASE_PUBLIC_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  -f _migrations/backup-$(date +%Y%m%d-%H%M%S).dump
```

Verify the dump file was created and is non-empty:

```bash
ls -lh _migrations/backup-*.dump | tail -1
```

If dump fails, **STOP**: "Database backup failed. Do not proceed without a backup."

Report: "Production backup saved to `_migrations/backup-YYYYMMDD-HHMMSS.dump` (X KB)"

## Phase 3: Assess Migrations

### 3.1 Read MIGRATIONS.md

Read `MIGRATIONS.md` from project root.

If `MIGRATIONS.md` has no entries (only the template header), skip to Phase 5.5 (no migrations needed — go straight to merge).

### 3.2 Analyze Changes

For each entry in MIGRATIONS.md:

1. **Read the referenced files** on `main` to understand the current (new) state
2. **Compare with `release`** to understand what production currently has:
   ```bash
   git diff origin/release..HEAD -- <relevant-files>
   ```
3. **Determine the net migration** — what SQL or data transformation is needed to go from production's current state to the new state

### 3.3 Classify Migration Complexity

| Complexity | Criteria | Action |
|-----------|---------|--------|
| **None** | No data affected (new tables only, new columns with defaults) | Skip — Drizzle handles DDL |
| **Simple** | Column renames, backfill FK from existing data, env var renames | Write migration automatically |
| **Complex** | Data transformation logic, ambiguous mappings, potential data loss | **STOP** and discuss with user |

### 3.4 Handle Complex Migrations

If any migration is classified as Complex:

1. Present the issue to the user:
   ```
   ## Migration Requires Discussion

   **Entry:** [MIGRATIONS.md entry]
   **Problem:** [why it's complex]
   **Options:**
   1. [Option A with trade-offs]
   2. [Option B with trade-offs]
   3. Skip this migration (manual intervention needed post-deploy)

   What would you like to do?
   ```

2. Wait for user input before proceeding.

## Phase 4: Write & Validate Migration

Only applies if Phase 3 found migrations to execute.

### 4.1 Identify Covered Drizzle Migrations

Check which Drizzle migration files (in `drizzle/`) are new since `release`:

```bash
git diff origin/release..HEAD --name-only -- drizzle/
```

Read the SQL content of each new Drizzle migration file. The manual migration script must cover **all DDL and data changes** so these Drizzle files don't need to run again. After the manual script executes, we mark these migrations as applied in Drizzle's journal table.

### 4.2 Write Migration SQL

Create a migration file at `_migrations/release-YYYYMMDD.sql` with:
- Transaction wrapper (`BEGIN; ... COMMIT;`)
- **All DDL changes** from the covered Drizzle migration files (use safe idioms: `IF NOT EXISTS`, nullable-then-backfill-then-NOT-NULL)
- **All data transformations** from MIGRATIONS.md entries
- **Drizzle journal inserts** to mark covered migrations as applied
- Comments explaining each operation

**PRIVACY RULE: Never hardcode user data in migration SQL.** The migration file lives in gitignored `_migrations/`, but always write data-agnostic SQL that derives values from existing database content (e.g., `SELECT DISTINCT email FROM sessions`) rather than hardcoding emails, names, or other personal data. This makes the migration work for any data state and avoids accidental leaks.

**Drizzle journal compatibility.** Drizzle decides which migrations to run by checking the `created_at` of the **most recent** row in `"drizzle"."__drizzle_migrations"` and running all migrations with a `when` timestamp (from `drizzle/meta/_journal.json`) greater than that value. The manual script must insert journal rows so Drizzle skips the covered migrations at deploy startup. These internals are verified in Phase 1.3 against the exact `node_modules` code that will run in production.

**Journal table details:**
- Schema-qualified: `"drizzle"."__drizzle_migrations"` (NOT `public`)
- Columns: `id` serial PK, `hash` text NOT NULL, `created_at` numeric
- `hash` = SHA-256 hex of the SQL file contents: `shasum -a 256 drizzle/XXXX.sql | cut -d' ' -f1`
- `created_at` = the `when` value from the corresponding entry in `drizzle/meta/_journal.json` (epoch milliseconds)

**Important:** Drizzle only compares `created_at` timestamps, not hashes, to decide what to run. But always insert correct hashes for integrity.

Example migration script structure:
```sql
-- Migration: main → release (YYYY-MM-DD)
-- Source: MIGRATIONS.md entries
-- Covers Drizzle migrations: 0005_clever_calypso, 0006_silky_roughhouse

BEGIN;

-- Step 1: DDL from Drizzle 0005 (safe for existing data)
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
ALTER TABLE "custom_foods" ADD COLUMN IF NOT EXISTS "user_id" uuid;
-- (nullable first — NOT NULL added after backfill)

-- Step 2: Data migration — derive from existing DB data, never hardcode
INSERT INTO users (id, email)
SELECT gen_random_uuid(), LOWER(email)
FROM (SELECT DISTINCT email FROM sessions) s
ON CONFLICT DO NOTHING;

UPDATE custom_foods SET user_id = u.id
FROM users u WHERE LOWER(custom_foods.email) = u.email AND custom_foods.user_id IS NULL;
-- ... same pattern for other tables ...

-- Step 3: Finalize DDL (NOT NULL, constraints, drops from 0006)
ALTER TABLE "custom_foods" ALTER COLUMN "user_id" SET NOT NULL;
-- ... FK constraints, unique constraints, column drops ...

-- Step 4: Mark Drizzle migrations as applied
-- hash: shasum -a 256 drizzle/<file>.sql | cut -d' ' -f1
-- created_at: "when" field from drizzle/meta/_journal.json for each entry
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
VALUES
  ('<sha256-of-0005-file>', 1770483401568),
  ('<sha256-of-0006-file>', 1770483422458);

COMMIT;
```

### 4.3 Validate Against Backup

Restore the production backup to a local test database and run the migration:

1. Restore backup:
   ```bash
   docker compose up -d
   docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS migration_test;"
   docker compose exec -T db psql -U postgres -c "CREATE DATABASE migration_test;"
   /opt/homebrew/opt/libpq/bin/pg_restore \
     --dbname="postgresql://postgres:postgres@localhost:5432/migration_test" \
     --no-owner --no-privileges \
     _migrations/backup-*.dump
   ```

2. Run the migration:
   ```bash
   /opt/homebrew/opt/libpq/bin/psql \
     "postgresql://postgres:postgres@localhost:5432/migration_test" \
     -f _migrations/release-YYYYMMDD.sql
   ```

3. Verify the migration succeeded (no errors)

4. Verify Drizzle journal entries were inserted:
   ```bash
   docker compose exec -T db psql -U postgres -d migration_test \
     -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;"
   ```
   Confirm the new entries appear for the covered migrations with correct `created_at` values matching `drizzle/meta/_journal.json`.

5. Clean up:
   ```bash
   docker compose exec -T db psql -U postgres -c "DROP DATABASE migration_test;"
   ```

If local Docker is not available, show the migration SQL to the user and ask for manual approval.

### 4.4 Show Migration to User

Regardless of validation, display the full migration SQL to the user for review:

```
## Migration SQL (will be applied to production)

[SQL content]

Validated against production backup: [yes/no]
Drizzle journal entries: [list of covered migration files]
Proceed with release?
```

Wait for user confirmation.

## Phase 5: Execute Release

### 5.1 Stop Production Service (if migration needed)

If migration SQL was written in Phase 4, stop the production app service before applying it. This eliminates any window of inconsistency between old code and migrated data.

First, capture the database URL while the service is still running (we already have it from Phase 2, but re-fetch to confirm):

```bash
DATABASE_PUBLIC_URL=$(railway run -e production -s food-scanner printenv DATABASE_PUBLIC_URL)
```

Then stop the service:

```bash
railway down -y -e production -s food-scanner
```

If the command fails, **STOP**: "Cannot stop production service. Check Railway CLI configuration."

**Note:** `railway down` removes the most recent deployment — the app stops serving requests. The database is a separate Railway service and continues running. No data is lost — sessions, tokens, and food logs are all in PostgreSQL. Pushing to `release` later creates a new deployment that brings the service back.

### 5.2 Apply Migration to Production

Run the migration using the URL captured in 5.1:

```bash
/opt/homebrew/opt/libpq/bin/psql "$DATABASE_PUBLIC_URL" -f _migrations/release-YYYYMMDD.sql
```

If the migration fails, **STOP**: "Migration failed on production. Service is down. Investigate before proceeding. Backup available at `_migrations/backup-*.dump`. To restore service, push current `release` branch again or redeploy from Railway dashboard."

### 5.3 Clear MIGRATIONS.md

Reset `MIGRATIONS.md` to its empty template:

```markdown
# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Do NOT write migration code here — that happens at release time.

<!-- Add entries below this line -->
```

### 5.4 Commit and Push to Main

Stage and commit the cleared `MIGRATIONS.md` (and migration SQL file if it exists):

```bash
git add MIGRATIONS.md
git commit -m "release: clear MIGRATIONS.md for release $(date +%Y-%m-%d)"
git push origin main
```

### 5.5 Merge Main to Release

```bash
git checkout release
git pull origin release
git merge origin/main --no-edit
git push origin release
git checkout main
```

If merge conflicts occur, **STOP** and tell the user to resolve them manually.

**Note:** Pushing to `release` triggers Railway auto-deploy. If the service was stopped in Phase 5.1, the deploy will bring it back up automatically. Drizzle runs at startup, sees the covered migrations already in `__drizzle_migrations`, and skips them.

## Phase 6: Post-Release

### 6.1 Report

```
## Release Complete

**Promoted:** main → release
**Commits:** N commits
**Backup:** _migrations/backup-YYYYMMDD-HHMMSS.dump
**Migration:** [Applied successfully | No migration needed]

### Environment Variable Changes
[List any env var renames/additions from MIGRATIONS.md, or "None"]

### Next Steps
- Monitor Railway deployment at production
- Verify production at https://food.lucaswall.me
- Check Railway deploy logs if issues arise
```

### 6.2 Remind About Env Vars

If MIGRATIONS.md mentioned any environment variable changes, remind the user:

```
**ACTION REQUIRED:** Update these environment variables in Railway production before the deploy completes:
- [OLD_VAR → NEW_VAR]
- [NEW_VAR=value to add]
```

## Error Handling

| Situation | Action |
|-----------|--------|
| Not on `main` | STOP — switch to main first |
| Dirty working tree | STOP — commit or stash |
| Behind remote | STOP — pull latest |
| Build/tests fail | STOP — fix before releasing |
| No commits to promote | STOP — nothing to do |
| DB backup fails | STOP — never release without backup |
| Complex migration | STOP — discuss with user |
| Migration SQL fails locally | STOP — fix migration before proceeding |
| Migration fails on production | STOP — service is down, investigate, backup available, restore service with `railway up` |
| Cannot stop production service | STOP — check Railway CLI |
| Drizzle internals changed | STOP — read migrator source, update skill before proceeding |
| Merge conflicts | STOP — user resolves manually |
| Railway CLI not available | STOP — install/login Railway CLI |
| pg_dump not found | STOP — `brew install libpq` |
| OrbStack not installed | STOP — `brew install orbstack` |
| OrbStack stopped | Start with `orb start`, then continue |
| Docker Compose db not running | Start with `docker compose up -d`, then continue |

## Rules

- **Always backup production DB first** — No exceptions
- **Never skip migration assessment** — Even if MIGRATIONS.md is empty, check the diff
- **Show migration SQL to user** — Always get explicit confirmation before applying
- **Stop service before migration, deploy brings it back** — `railway down` before migration, push to `release` restarts the service
- **Manual migration covers Drizzle DDL + data + journal** — One atomic script does everything; Drizzle skips already-applied migrations at startup
- **Clear MIGRATIONS.md after release** — Reset to empty template on main
- **No co-author attribution** — Commit messages must NOT include `Co-Authored-By` tags
- **Never force-push** — Use normal merge only
- **Backup files stay local** — `_migrations/` is gitignored
- **Never hardcode user data in SQL** — Derive from existing DB content (SELECT DISTINCT, JOINs), never hardcode emails, names, or personal data
- **Stop on any failure** — Better to abort than corrupt production
