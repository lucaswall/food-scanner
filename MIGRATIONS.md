# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 2026-05-04 — Macro engine correctness (F1)

**Migration:** `drizzle/0023_young_doctor_faustus.sql`

Schema changes:
- `daily_calorie_goals`: adds `goal_type text`, `bmi_tier text`, `profile_version integer`, `weight_logged_date date` (all nullable).
- `users`: adds `macro_profile_version integer NOT NULL DEFAULT 1`.

No data migration required:
- New columns on `daily_calorie_goals` are nullable; legacy rows pass through and the cache-hit path falls back to live Fitbit values with a warn log (`action: "daily_goals_legacy_audit"`).
- `users.macro_profile_version` has a `DEFAULT 1`, so existing rows backfill automatically on `ALTER TABLE`.

Behavioral note: cache-hit audit now reflects the goal/BMI tier active when the row was written, not current Fitbit state.

## 2026-05-04 — Macro profile CHECK constraint (F4)

**Migration:** `drizzle/0024_far_roland_deschain.sql`

Adds `users_macro_profile_chk` CHECK constraint on `users.macro_profile` constraining values to `('muscle_preserve', 'metabolic_flex')`.

**Pre-flight check** before applying to production: `SELECT DISTINCT macro_profile FROM users` must return only the two known values. If any other value exists (manual psql edits or future migration drift), the ALTER TABLE will fail. Clean up first:

```sql
-- inspect first
SELECT id, email, macro_profile FROM users WHERE macro_profile NOT IN ('muscle_preserve', 'metabolic_flex');
-- if rows exist, decide per-user whether to reset to default
UPDATE users SET macro_profile = 'muscle_preserve' WHERE macro_profile NOT IN ('muscle_preserve', 'metabolic_flex');
```

`getMacroProfile` also now logs `action: "macro_profile_invalid_key"` on read when an unknown value is encountered, so any drift becomes observable.

## 2026-05-04 — Profile-change invalidation scope (C1, FOO-995)

**No DB migration. Behavior change only.**

`invalidateUserDailyGoalsForProfileChange` now scopes the row clear to today + forward (was: all historical rows). Pre-existing zeroed historical rows from the prior behavior remain zeroed and lazily recompute on view (one-time cost). The macro-profile API now passes today's date.

No data cleanup required: the old behavior left `calorie_goal=0` in many historical rows; opening those days will now trigger a single Fitbit recompute per day visited, which writes the goal/profile context for that day going forward.

## 2026-05-04 — External API breaking change (A1, FOO-1008)

**No DB migration. External API contract change.**

`GET /api/v1/nutrition-goals` was a passthrough to Fitbit's food-goal endpoint returning `{ calories: number | null }`. It now returns the engine-computed `NutritionGoals` shape with two modes:

- **Single-date** (`?date=YYYY-MM-DD`, default today): `{ date, calories, proteinG, carbsG, fatG, status, reason?, audit?, profileKey }`. Calls `getOrComputeDailyGoals` and may compute under user-driven Fitbit fan-out.
- **Range** (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, span ≤ 90 days): `{ entries: [...], profileKey }` — read-only from `daily_calorie_goals`. Days without rows return `status: "blocked", reason: "not_computed"`. No engine backfill.

External consumers should migrate. Top-level `data.calories` remains a `number | null`, so consumers reading just that field still work.

`getFoodGoals` and `FitbitFoodGoals` deleted (no remaining callers).
