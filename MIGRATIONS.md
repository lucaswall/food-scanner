# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## FOO-1036: `tdee_source` column on `daily_calorie_goals`

**Schema change (auto-applied by Drizzle):** `ALTER TABLE daily_calorie_goals ADD COLUMN tdee_source text` — nullable, no default.

**Data backfill:** None required. Legacy rows have `tdee_source = NULL`, which the read path treats as `'live'` (only ratchet UP applies; never re-seeded).

**Behavior after deploy:** Starting on the first read after deploy, today's row will be INSERTed (or UPDATEd) with `tdee_source` populated as `'live' | 'history' | 'default'`. The status `partial` is gone — every authenticated user with sex/weight/height set will see calorie + carbs goals at all times of day. The FOO-995 historical-rows-stay-zeroed invariant is preserved (historical rows recompute lazily on view via the seeded path).

**Production safety:** PostgreSQL fast-path applies (nullable column, no default) — `ALTER TABLE` is metadata-only and safe under load.
