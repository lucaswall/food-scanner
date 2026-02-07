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

### 1.3 Build & Tests

Run the `verifier` agent to confirm build and tests pass:

```
Use Task tool with subagent_type "verifier"
```

If verifier reports failures, **STOP**. Do not proceed with a broken build.

### 1.4 Release Branch Exists

```bash
git rev-parse --verify origin/release
```

If `release` branch doesn't exist, **STOP** and tell the user to create it.

### 1.5 Diff Assessment

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

If `MIGRATIONS.md` has no entries (only the template header), skip to Phase 5 (no migrations needed).

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

### 4.1 Write Migration SQL

Create a migration file at `_migrations/release-YYYYMMDD.sql` with:
- Transaction wrapper (`BEGIN; ... COMMIT;`)
- The net data migration SQL (not intermediate steps)
- Comments explaining each operation

Example:
```sql
-- Migration: main → release (YYYY-MM-DD)
-- Source: MIGRATIONS.md entries

BEGIN;

-- Create users table and backfill from existing email data
-- [actual SQL here]

COMMIT;
```

### 4.2 Validate Against Backup

If Docker Compose Postgres is available for local testing:

1. Restore backup to a local test database:
   ```bash
   docker compose up -d
   # Create a temporary test database
   docker compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS migration_test;"
   docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE migration_test;"
   /opt/homebrew/opt/libpq/bin/pg_restore \
     --dbname="postgresql://postgres:postgres@localhost:5432/migration_test" \
     --no-owner --no-privileges \
     _migrations/backup-*.dump
   ```

2. Run the migration:
   ```bash
   docker compose exec -T postgres psql -U postgres -d migration_test -f -
   ```
   (pipe the SQL file in)

3. Verify the migration succeeded (no errors)

4. Clean up:
   ```bash
   docker compose exec -T postgres psql -U postgres -c "DROP DATABASE migration_test;"
   ```

If local Docker is not available, show the migration SQL to the user and ask for manual approval.

### 4.3 Show Migration to User

Regardless of validation, display the full migration SQL to the user for review:

```
## Migration SQL (will be applied to production)

[SQL content]

Validated against production backup: [yes/no]
Proceed with release?
```

Wait for user confirmation.

## Phase 5: Execute Release

### 5.1 Apply Migration to Production (if needed)

If migration SQL was written in Phase 4, apply it to production BEFORE merging code:

```bash
railway run -e production -s food-scanner printenv DATABASE_PUBLIC_URL
```

Then run the migration:
```bash
/opt/homebrew/opt/libpq/bin/psql "$DATABASE_PUBLIC_URL" -f _migrations/release-YYYYMMDD.sql
```

If the migration fails, **STOP**: "Migration failed on production. Investigate before proceeding. Backup available at `_migrations/backup-*.dump`."

### 5.2 Clear MIGRATIONS.md

Reset `MIGRATIONS.md` to its empty template:

```markdown
# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Do NOT write migration code here — that happens at release time.

<!-- Add entries below this line -->
```

### 5.3 Commit and Push to Main

Stage and commit the cleared `MIGRATIONS.md` (and migration SQL file if it exists):

```bash
git add MIGRATIONS.md
git commit -m "release: clear MIGRATIONS.md for release $(date +%Y-%m-%d)"
git push origin main
```

### 5.4 Merge Main to Release

```bash
git checkout release
git pull origin release
git merge origin/main --no-edit
git push origin release
git checkout main
```

If merge conflicts occur, **STOP** and tell the user to resolve them manually.

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
| Migration fails on production | STOP — investigate, backup available |
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
- **Apply data migration before code deploy** — Migration runs against current schema, new code deploys after
- **Clear MIGRATIONS.md after release** — Reset to empty template on main
- **No co-author attribution** — Commit messages must NOT include `Co-Authored-By` tags
- **Never force-push** — Use normal merge only
- **Backup files stay local** — `_migrations/` is gitignored
- **Stop on any failure** — Better to abort than corrupt production
