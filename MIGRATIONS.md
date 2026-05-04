# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 2026-05-03 — Macro engine: fitbit_tokens.scope + daily_calorie_goals macro/audit columns

**What changed (additive, no data backfill in this step):**

- `fitbit_tokens.scope` (nullable `text`) — populated lazily on each user's next OAuth exchange. NULL means "legacy `nutrition activity` only" → triggers the scope-mismatch banner. Both Lucas and Mariana will see "Reconnect Fitbit" once after deploy and both must reconnect to populate the column.
- `daily_calorie_goals` gains nullable columns: `protein_goal int`, `carbs_goal int`, `fat_goal int`, `weight_kg numeric`, `calories_out int`, `rmr int`, `activity_kcal int`. All nullable so existing rows migrate cleanly. Lumen-backfilled rows (see later entry) will carry NULL audit columns to mark their historical-Lumen origin.

**Migration handling:** Standard Drizzle migration — auto-runs at startup. No backfill required for this step.

## 2026-05-03 — Invalidate engine-computed daily_calorie_goals rows (Fitbit unit-system bug)

**Type:** Data-only migration. Run AFTER deploy of the Accept-Language fix.

**Why:** Before this fix, `getFitbitProfile` / `getFitbitLatestWeightKg` sent `Accept-Language: en_US`, which caused Fitbit to return `user.height` in inches and `weight[].weight` in pounds. The macro engine (PR #137 / commit `393dff4`) treated those values as cm/kg, so every engine-computed row in `daily_calorie_goals` since that release contains:
- `weight_kg` storing pounds (≈ 2.2× the real kg value)
- `rmr` / `activity_kcal` / `calorie_goal` / `protein_goal` / `carbs_goal` / `fat_goal` derived from imperial-as-metric inputs (calorieGoal overstated by hundreds of kcal, protein roughly 2.2× too high)

**Affected rows:** Engine-computed rows have non-NULL `weight_kg` AND non-NULL `rmr` AND non-NULL `activity_kcal`. Lumen-backfilled rows (which have those columns NULL) are NOT affected and must be preserved.

**Recovery:** Null out the macro/audit columns on engine-computed rows so `daily-goals.ts` re-derives them from corrected Fitbit data on next read. Do NOT delete the row (would lose `calorie_goal` for any historical day that had a pre-existing value).

```sql
UPDATE daily_calorie_goals
SET protein_goal  = NULL,
    carbs_goal    = NULL,
    fat_goal      = NULL,
    weight_kg     = NULL,
    calories_out  = NULL,
    rmr           = NULL,
    activity_kcal = NULL,
    updated_at    = NOW()
WHERE weight_kg IS NOT NULL
  AND rmr IS NOT NULL
  AND activity_kcal IS NOT NULL;
```

**Notes:**
- Both Lucas and Mariana need to load the dashboard once after the migration so `getOrComputeDailyGoals` re-derives today's row from corrected Fitbit data.
- Historical days that still have a non-zero `calorie_goal` keep that column intact (it's not nulled). Macros for historical days will be re-derived only when next requested for that date.
- The `Accept-Language` regression test added in `src/lib/__tests__/fitbit.test.ts` prevents this from re-occurring.

## 2026-05-03 — Macro engine: backfill lumen_goals → daily_calorie_goals macros, then DROP lumen_goals

**Type:** Data-only migration (must run BEFORE the auto-generated `DROP TABLE lumen_goals`).

**Why:** Preserve each user's Lumen history (per-day P/C/F goals) as macro columns on `daily_calorie_goals`, so historical days remain meaningful in the dashboard / chat / user-profile after the Lumen flow is removed.

**push-to-production must execute these steps in order:**

1. Run the backfill SQL (manual data-only step):

```sql
INSERT INTO daily_calorie_goals (user_id, date, calorie_goal, protein_goal, carbs_goal, fat_goal, created_at, updated_at)
SELECT lg.user_id, lg.date, COALESCE(dcg.calorie_goal, 0), lg.protein_goal, lg.carbs_goal, lg.fat_goal, NOW(), NOW()
FROM lumen_goals lg
LEFT JOIN daily_calorie_goals dcg ON dcg.user_id = lg.user_id AND dcg.date = lg.date
ON CONFLICT (user_id, date) DO UPDATE
  SET protein_goal = EXCLUDED.protein_goal,
      carbs_goal   = EXCLUDED.carbs_goal,
      fat_goal     = EXCLUDED.fat_goal,
      updated_at   = NOW();
```

2. Then deploy the new app — Drizzle migration `0021_mushy_madripoor.sql` runs automatically and DROPs `lumen_goals`.

**Notes:**
- Backfilled rows intentionally have `weight_kg`, `calories_out`, `rmr`, `activity_kcal` as NULL — that's the historical-Lumen marker, distinguishing them from engine-computed rows.
- Where a Lumen row had no matching `daily_calorie_goals` row, the INSERT creates one with `calorie_goal = 0`. The dashboard treats `calorie_goal = 0` as "no calorie goal set" and macros still render. Acceptable for historical days.
- Both Lucas and Mariana have Lumen history; both users' rows are preserved.
