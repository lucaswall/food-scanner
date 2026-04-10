---
name: staging-qa
description: Automated functional QA against the staging site using Chrome browser automation. Trigger on "staging qa", "run qa", "test staging". Navigates the real staging app, runs test scenarios with GIF recording, and reports results.
argument-hint: "[gif] [scenarios] — 'gif' enables GIF recording per scenario. Scenario names filter which to run (e.g., 'gif dashboard analyze'). Omit to run all without GIFs."
allowed-tools: Read, Glob, Grep, Bash, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__form_input, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__javascript_tool, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__read_network_requests, mcp__claude-in-chrome__gif_creator, mcp__claude-in-chrome__resize_window, mcp__Railway__get-logs, mcp__sentry__search_issues
disable-model-invocation: true
---

ultrathink

Automated functional QA against the live staging site (`food-test.lucaswall.me`) using Chrome browser automation. Runs test scenarios, seeds test data, performs functional AND visual assessment, cleans up via DB, checks server logs, and reports results. GIF recording is optional.

## Phase 1: Pre-flight

1. **Verify Chrome extension** — Call `tabs_context_mcp` to check the Chrome extension is connected.
   - If error → STOP: "Chrome extension not connected. Open Chrome, ensure the Claude Code extension is active, then re-run `/staging-qa`."

2. **Create a new tab** — Use `tabs_create_mcp` to open a fresh tab. Record the tab ID for all subsequent operations.

3. **Navigate to staging** — Use `navigate` to go to `https://food-test.lucaswall.me/app`.

4. **Verify login** — Use `read_page` or `find` to check for the main navigation element (role: navigation, name: "Main navigation").
   - If login page is shown instead → STOP: "Not logged into staging. Please log in at food-test.lucaswall.me, then re-run `/staging-qa`."

5. **Set mobile viewport** — Use `resize_window` to set the viewport to **390×844** (iPhone 14 equivalent). The app is used 100% on mobile — all scenarios must run at mobile width.

6. **Switch to light mode** — Use `javascript_tool` to run `localStorage.setItem("theme", "light")`, then reload the page via `navigate` to the same URL. This ensures screenshots have sufficient contrast for visual QA (dark mode dialogs and overlays render as black in screenshots). Verify light mode is active by checking the page background is white.

7. **Record tab ID** — Store the tab ID for use in all subsequent browser tool calls.

## Phase 2: Test Data Seeding

Seed the staging database with realistic food entries so pages render with meaningful data for visual assessment. This runs via `psql` against the staging DB.

### 2.1 Get Staging DB URL

```bash
railway run -e staging printenv DATABASE_PUBLIC_URL
```

Store the URL for use in seeding and cleanup steps. If this fails, WARN but continue — scenarios will run against whatever data exists.

### 2.2 Get User ID

```bash
psql "$DB_URL" -t -A -c "SELECT id FROM users WHERE email = 'wall.lucas@gmail.com' LIMIT 1;"
```

### 2.3 Seed Test Data

Insert entries covering **today and the past 7 days** so both daily and weekly views render real data. Use `[QA Seed]` prefix for food names (distinct from `[QA Test]` used in functional scenarios).

**Strategy:** Insert into `custom_foods` first (the food definitions), then `food_log_entries` (the log records that reference them). Use relative dates so data is always fresh.

```sql
-- Create QA seed custom foods
INSERT INTO custom_foods (user_id, food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, confidence)
VALUES
  (:uid, '[QA Seed] Scrambled eggs with toast', 1, 304, 320, '22', '28', '14', '2', '450', 'high'),
  (:uid, '[QA Seed] Grilled chicken with rice', 1, 304, 550, '45', '52', '12', '3', '380', 'high'),
  (:uid, '[QA Seed] Banana smoothie', 1, 304, 280, '8', '52', '4', '5', '30', 'high'),
  (:uid, '[QA Seed] Caesar salad', 1, 304, 380, '18', '22', '24', '4', '620', 'high'),
  (:uid, '[QA Seed] Pasta with meat sauce', 1, 304, 620, '32', '68', '18', '6', '720', 'high')
RETURNING id;
```

Then insert log entries using the returned IDs, distributing across the past 7 days with varying meal times and types:

```sql
-- meal_type_id: 1=Breakfast, 3=Lunch, 5=Dinner, 7=Snack
-- Spread 2-3 entries per day across today and past 6 days
INSERT INTO food_log_entries (user_id, custom_food_id, meal_type_id, amount, unit_id, date, time)
VALUES
  -- Today
  (:uid, :eggs_id, 1, 1, 304, CURRENT_DATE, '08:30'),
  (:uid, :chicken_id, 3, 1, 304, CURRENT_DATE, '13:00'),
  -- Yesterday
  (:uid, :smoothie_id, 1, 1, 304, CURRENT_DATE - 1, '09:00'),
  (:uid, :pasta_id, 3, 1, 304, CURRENT_DATE - 1, '12:30'),
  (:uid, :salad_id, 5, 1, 304, CURRENT_DATE - 1, '19:30'),
  -- 2 days ago
  (:uid, :eggs_id, 1, 1, 304, CURRENT_DATE - 2, '08:00'),
  (:uid, :chicken_id, 5, 1, 304, CURRENT_DATE - 2, '20:00'),
  -- 3 days ago
  (:uid, :smoothie_id, 7, 1, 304, CURRENT_DATE - 3, '10:00'),
  (:uid, :pasta_id, 5, 1, 304, CURRENT_DATE - 3, '19:00'),
  -- 4 days ago
  (:uid, :salad_id, 3, 1, 304, CURRENT_DATE - 4, '12:00'),
  (:uid, :chicken_id, 5, 1, 304, CURRENT_DATE - 4, '19:00'),
  -- 5 days ago
  (:uid, :eggs_id, 1, 1, 304, CURRENT_DATE - 5, '08:30'),
  (:uid, :pasta_id, 3, 1, 304, CURRENT_DATE - 5, '13:00'),
  -- 6 days ago
  (:uid, :smoothie_id, 1, 1, 304, CURRENT_DATE - 6, '09:00'),
  (:uid, :chicken_id, 5, 1, 304, CURRENT_DATE - 6, '19:30');
```

Then insert saved analyses so the dashboard "Saved for Later" section renders:

```sql
-- Create QA seed saved analyses
INSERT INTO saved_analyses (user_id, food_analysis, description, calories)
VALUES
  (:uid, '{"food_name":"[QA Seed] Saved grilled chicken","amount":1,"unit_id":304,"calories":450,"protein_g":42,"carbs_g":0,"fat_g":10,"fiber_g":0,"sodium_mg":350,"saturated_fat_g":3,"trans_fat_g":0,"sugars_g":0,"calories_from_fat":90,"confidence":"high","notes":"Grilled chicken breast, no skin","description":"Grilled chicken breast seasoned with herbs","keywords":["chicken","grilled","breast"]}'::jsonb, '[QA Seed] Saved grilled chicken', 450),
  (:uid, '{"food_name":"[QA Seed] Saved banana","amount":1,"unit_id":304,"calories":105,"protein_g":1.3,"carbs_g":27,"fat_g":0.4,"fiber_g":3.1,"sodium_mg":1,"saturated_fat_g":0.1,"trans_fat_g":0,"sugars_g":14,"calories_from_fat":3.6,"confidence":"high","notes":"Medium banana","description":"One medium banana","keywords":["banana","fruit"]}'::jsonb, '[QA Seed] Saved banana', 105);
```

**Implementation:** Build the full SQL as a single script with CTEs or sequential statements. Execute via `psql "$DB_URL" -c "..."`. The above is pseudocode — the actual SQL must use real values (not `:uid` placeholders). Use nested CTEs or a DO block to capture the user ID and custom_food IDs.

**If seeding fails:** WARN but continue — scenarios still run, just with less visual data.

## Phase 3: Connection Resilience Protocol

Apply these rules throughout ALL browser interactions:

- **Heartbeat before every step:** Call `tabs_context_mcp` before each browser tool call. This keeps the Chrome MV3 service worker alive (it terminates after ~30s idle).
- **Silent auto-retry on disconnection:** If any browser tool returns a connection error or "Browser extension is not connected":
  1. Wait 2 seconds.
  2. Call `tabs_context_mcp` to re-establish context.
  3. If successful, re-fetch the tab ID and resume from the current step.
  4. If still disconnected, wait 2 more seconds and retry (up to 3 total attempts).
  5. Only after 3 failed retries, ask the user: "Chrome connection lost after 3 retries. Please check the extension and confirm to continue."
- **Never assume tab IDs persist** after any connection interruption — always re-fetch via `tabs_context_mcp`.

## Phase 4: Scenario Runner

1. **Load scenarios** — Read `references/test-scenarios.md` for scenario definitions.

2. **Parse arguments** — If `$ARGUMENTS` is provided, split on whitespace. Extract the `gif` keyword (enables GIF recording). Remaining tokens are scenario slug names to filter. Valid slugs: `dashboard`, `weekly`, `analyze`, `refine`, `log`, `delete`, `quick-select`, `food-detail`, `edit`, `labels`, `settings`, `chat`, `save`, `log-saved`, `capture`, `share`. If no slug tokens, run all scenarios in order.

3. **For each scenario:**

   a. **Check dependencies** — If the scenario depends on a prior scenario that FAILED or was SKIPPED, mark this scenario as SKIP with reason "dependency [scenario-name] failed".

   b. **If GIF mode:** Start GIF recording — call `gif_creator` with action `start_recording`.

   c. **Execute scenario steps** — Follow the step-by-step instructions from the scenario definition. Between each step:
      - Call `tabs_context_mcp` (heartbeat)

   d. **Visual assessment screenshot** — After the scenario reaches its "ready" state (page fully loaded, data rendered, dialog open — whatever the scenario's main view is), take ONE deliberate screenshot and evaluate it for:
      - **Layout integrity:** Is anything overlapping, clipped, or overflowing the viewport?
      - **Content rendering:** Are there blank areas that should have content, stuck spinners, or placeholder text still showing?
      - **Mobile fit:** Does everything fit within 390px width? Any horizontal scrollbar or cut-off elements?
      - **Visual coherence:** Does the page look structurally sound — not a broken build artifact or unstyled content?
      Record visual issues as WARN in the scenario result (doesn't cause FAIL, but gets reported).

   e. **Evaluate pass/fail** — Check the scenario's functional pass criteria. Record the result.

   f. **If GIF mode:** Take extra frames, then stop and export GIF — call `gif_creator` with action `stop_recording`, then `export` with `download: true` and filename `staging-qa-{scenario-slug}.gif`.

   g. **Record result** — PASS, FAIL (with error details), SKIP (with reason), or PASS with WARN (visual issues noted).

4. **Continue to next scenario** regardless of the previous result (unless the next depends on it).

### SSE / AI Analysis Wait Strategy

When waiting for AI results (analyze, refine, edit scenarios):
- **Poll actively** using `find` or `read_page` every **8 seconds**.
- **Total budget: 90 seconds** (real AI analysis takes 9-35s on staging).
- **Each poll doubles as a heartbeat** — keeps the Chrome service worker alive.
- **Never use a single long `computer` wait** — the 30s max would kill the connection.
- **Check for error states** in the DOM (error messages, error toasts) at each poll — fail fast if the analysis errored.

### Screenshot Budget

To minimize token waste from screenshots:
- **ONE visual assessment screenshot per scenario** — the deliberate QA evaluation moment.
- **Skip mid-step screenshots** unless in GIF mode (where they're needed for smooth playback).
- **Use `find`/`read_page` for functional checks** — cheaper than screenshots for verifying element presence.

## Phase 5: Cleanup

After all scenarios complete (regardless of pass/fail):

### 5.0 Restore Theme

Use `javascript_tool` to run `localStorage.setItem("theme", "system")` to restore the user's default theme preference.

### 5.1 DB Cleanup (seed data + any test entries)

Using the staging DB URL from Phase 2:

```sql
-- Remove QA saved analyses (before custom_foods cleanup)
DELETE FROM saved_analyses WHERE description LIKE '[QA Seed]%' OR description LIKE '[QA Test]%';

-- Remove QA seed log entries (via custom_foods FK)
DELETE FROM food_log_entries WHERE custom_food_id IN (
  SELECT id FROM custom_foods WHERE food_name LIKE '[QA Seed]%'
);
-- Remove QA seed custom foods
DELETE FROM custom_foods WHERE food_name LIKE '[QA Seed]%';

-- Remove any QA Test entries created by functional scenarios
DELETE FROM food_log_entries WHERE custom_food_id IN (
  SELECT id FROM custom_foods WHERE food_name LIKE '[QA Test]%'
);
DELETE FROM custom_foods WHERE food_name LIKE '[QA Test]%';
```

**If DB cleanup fails:** WARN in the report, then fall back to UI-based cleanup (Phase 5.2).

### 5.2 UI Verification of Cleanup

After DB cleanup, verify in the browser:

1. **Navigate to history** — Go to `/app/history`.
2. **Search for remaining test entries** — Use `find` to look for any entries containing "[QA Seed]" or "[QA Test]".
3. If any remain (DB cleanup may have failed), **delete via UI** as fallback:
   - Click the delete button for each remaining test entry
   - Confirm deletion
4. **Report cleanup status.**

## Phase 6: Server Health Check

Check for server-side errors during the QA run.

### 6.1 Railway Logs

Use `mcp__Railway__get-logs` to pull recent staging logs. Filter for:
- `ERROR`, `WARN`, `500`, `unhandled`, `timeout`, `ECONNREFUSED`
- Ignore expected patterns: health check 200s, static asset requests

Record any server errors found.

### 6.2 Sentry Issues

Use `mcp__sentry__search_issues` to check for new issues in the staging environment:
- Organization: `lucas-wall`
- Project: `food-scanner`
- Filter by environment: `staging`
- Look for issues with `firstSeen` during the QA run window

Record any new Sentry issues found.

## Phase 7: Report

Output a markdown summary to the conversation (NOT to a file):

```
## Staging QA Report — YYYY-MM-DD

| Scenario | Result | Visual | Details |
|----------|--------|--------|---------|
| Dashboard loads | PASS/FAIL/SKIP | OK/WARN | |
| Weekly view | PASS/FAIL/SKIP | OK/WARN | |
| Analyze food | PASS/FAIL/SKIP | OK/WARN | |
| Refine with chat | PASS/FAIL/SKIP | OK/WARN | |
| Log to Fitbit | PASS/FAIL/SKIP | OK/WARN | |
| Delete test entry | PASS/FAIL/SKIP | OK/WARN | |
| Quick Select | PASS/FAIL/SKIP | OK/WARN | |
| Food detail | PASS/FAIL/SKIP | OK/WARN | |
| Edit entry | PASS/FAIL/SKIP | OK/WARN | |
| Labels page | PASS/FAIL/SKIP | OK/WARN | |
| Settings page | PASS/FAIL/SKIP | OK/WARN | |
| Chat page | PASS/FAIL/SKIP | OK/WARN | |
| Save for Later | PASS/FAIL/SKIP | OK/WARN | |
| Log saved food | PASS/FAIL/SKIP | OK/WARN | |
| Quick Capture | PASS/FAIL/SKIP | OK/WARN | |
| Shared Food | PASS/FAIL/SKIP | OK/WARN | |

**Summary:** X/Y passed, N failed, M skipped
**Visual warnings:** [None / list of visual issues per scenario]
**Cleanup:** [All test data removed via DB / Fallback UI cleanup used / N entries remain]
**Server health:** [No errors / N Railway log errors / N new Sentry issues]
**Connection:** [No drops / N silent auto-retries / N user-prompted reconnections]
**GIF recordings:** [list of GIF filenames, or "disabled"]
```

For failed scenarios, include:
- What was expected
- What actually happened
- Which step failed

For visual warnings, include:
- What looked wrong
- Which part of the page was affected

For server errors, include:
- Error message summary
- Timestamp
- Sentry issue link if applicable

## Error Handling

| Situation | Action |
|-----------|--------|
| Chrome extension not connected | STOP — ask user to activate extension |
| Not logged into staging | STOP — ask user to log in |
| Connection lost mid-scenario | Silent auto-retry (3x), then ask user |
| AI analysis timeout (>90s) | FAIL the scenario, continue to next |
| Element not found | Retry once after 3s, then FAIL |
| Unexpected page state | Take screenshot, FAIL with description |
| DB seeding fails | WARN but continue (less visual data) |
| DB cleanup fails | WARN, fall back to UI cleanup |
| Railway logs unavailable | WARN, skip server health check |
| Tab closed by user | Re-create tab, resume from current scenario |

## Rules

- **All test entries use "[QA Test]" prefix** in food names for functional scenarios.
- **All seed data uses "[QA Seed]" prefix** for identification and cleanup.
- **SSE analysis waits: poll DOM every 8 seconds**, total budget 90 seconds. Never use a single long wait.
- **Use `find` (natural language)** for element discovery — self-healing by nature, no brittle CSS selectors.
- **Use `computer` type action for text inputs** — `form_input` does not trigger React onChange handlers and leaves the component state stale. Always click the input first, then type with `computer`.
- **Use `read_page` with `filter: "interactive"`** to discover form elements — reduces output size.
- **Report only** — this skill does NOT modify application code.
- **Advisory** — results do not gate deployments.
- **Each scenario is independent** unless explicitly chained via dependencies.
- **Always clean up** — DB cleanup is primary, UI cleanup is fallback.
- **GIF recording is opt-in** — only enabled when `gif` is in `$ARGUMENTS`. Each scenario gets its own recording with a descriptive filename.
- **Heartbeat before every browser call** — `tabs_context_mcp` keeps the connection alive.
- **One visual assessment screenshot per scenario** — minimize token waste, maximize QA value.
- **Silent reconnection** — auto-retry 3 times before asking the user.

## What NOT to Do

1. **Don't modify code** — this skill only tests the staging site
2. **Don't write results to files** — report to the conversation only
3. **Don't use hardcoded CSS selectors** — use `find` with natural language
4. **Don't use single long waits** — always poll actively
5. **Don't skip cleanup** — test data must be removed (DB first, UI fallback)
6. **Don't gate deployments** — results are advisory
7. **Don't take unnecessary screenshots** — one visual assessment per scenario, use `find`/`read_page` for functional checks
8. **Don't ask the user on first disconnection** — auto-retry 3 times silently first
