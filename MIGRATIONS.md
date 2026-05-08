# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## FOO-1040: Goal-anchored calorie engine — schema migration

**Dropped columns:**
- `users.macro_profile` (text, NOT NULL) — profile-selector column no longer used; data lost (irrelevant after rework)
- `users.macro_profile_version` (integer, NOT NULL) — version counter for profile race-safety; no longer needed
- `users_macro_profile_chk` CHECK constraint on `users.macro_profile`
- `daily_calorie_goals.calories_out` (integer) — Fitbit activity read no longer an engine input
- `daily_calorie_goals.activity_kcal` (integer) — derived from caloriesOut; no longer computed
- `daily_calorie_goals.bmi_tier` (text) — BMI-tier-indexed protein logic removed
- `daily_calorie_goals.goal_type` (text) — direction now derived from goalWeight vs currentWeight
- `daily_calorie_goals.profile_version` (integer) — profile-version race-safety removed
- `daily_calorie_goals.tdee_source` (text) — seed/live distinction removed

**Added columns:**
- `users.activity_level` (text, nullable) — declared PAL activity level; one of sedentary/light/moderate/very_active/extra_active
- `users.goal_weight_kg` (numeric, nullable) — user's target body weight in kg
- `users.goal_rate_kg_per_week` (numeric, nullable) — desired weekly weight change rate in kg/week (≥ 0)
- `users_activity_level_chk` CHECK on `users.activity_level`
- `users_goal_rate_chk` CHECK on `users.goal_rate_kg_per_week`
- `daily_calorie_goals.activity_level` (text, nullable) — snapshot of user's activity level at compute time
- `daily_calorie_goals.goal_weight_kg` (numeric, nullable) — snapshot of user's goal weight at compute time
- `daily_calorie_goals.goal_rate_kg_per_week` (numeric, nullable) — snapshot of user's goal rate at compute time
- `daily_calorie_goals.tdee` (integer, nullable) — TDEE = RMR × PAL, snapshotted at compute time
- `daily_calorie_goals.deficit_kcal` (integer, nullable) — signed deficit: negative for LOSE, positive for GAIN, 0 for MAINTAIN

**Data step (must run after DDL):**
```sql
DELETE FROM daily_calorie_goals WHERE date >= CURRENT_DATE;
```
This wipes today and future rows so the new engine computes fresh values. Historical rows retain their `calorie_goal`/macro values for the date-history view; their new audit columns will read NULL (gracefully handled by the UI).

**Cutover note:** The new `users.activity_level`, `goal_weight_kg`, and `goal_rate_kg_per_week` columns default to NULL. All users will see the goals-setup banner on their next dashboard visit until they configure their goals in Settings.
