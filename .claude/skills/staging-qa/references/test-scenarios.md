# Test Scenarios

## Scenario 1: Dashboard Loads

- **Slug:** `dashboard`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app` (the dashboard).
2. Wait for page to fully load — use `find` to look for "Main navigation" (role: navigation).
3. Verify the **Daily/Weekly tab buttons** are visible — use `find` to look for "Daily" and "Weekly" buttons.
4. Verify **calorie/nutrition data renders** — use `read_page` to check for numeric content in the nutrition summary area (any number followed by "cal" or "kcal", or a progress bar/ring). Don't check exact values — just verify data is present.
5. Check for **console errors** — call `read_console_messages` with `onlyErrors: true`. Filter out known benign errors (e.g., favicon 404, third-party script errors).

### Pass Criteria

- Main navigation is visible
- Daily and Weekly tabs are visible and clickable
- Nutrition data renders (at least one calorie value displayed)
- No unexpected console errors

---

## Scenario 2: Analyze Food (text-only, real AI)

- **Slug:** `analyze`
- **Depends on:** none
- **Expected timing:** 15-45 seconds (real AI analysis)

### Steps

1. Navigate to `/app/analyze`.
2. Verify the **"Analyze Food" heading** is visible — use `find` to look for heading with text "Analyze Food".
3. Find the **description textarea** — use `find` to look for a textarea (placeholder contains "e.g.").
4. Enter test text using `form_input`: `[QA Test] Two scrambled eggs with toast`
5. Find and click the **"Analyze Food" button** — use `find` to locate the button, then `computer` to click it.
6. **Wait for AI analysis** using the SSE polling strategy:
   - Set a timer: 90 seconds total budget.
   - Every 8 seconds, call `find` looking for either:
     - A food name heading in the results area (indicates analysis complete)
     - A calorie number (e.g., text matching a number followed by "cal")
     - An error message or error toast (indicates analysis failed — fail fast)
   - Take a screenshot at each poll (for GIF smoothness).
   - If 90 seconds elapse with no result → FAIL with "AI analysis timed out after 90 seconds".
7. **Verify the analysis result:**
   - A food name heading appeared (should contain something related to "eggs" or "toast" or the food described)
   - A calorie value is displayed and is a reasonable number (50-2000 range)
   - A **"Log to Fitbit"** button is visible
8. Check for console errors.

### Pass Criteria

- Analysis completes within 90 seconds
- Food name heading appears
- Calorie value is displayed and in a reasonable range (50-2000)
- "Log to Fitbit" button is visible
- No unexpected console errors

---

## Scenario 3: Log to Fitbit (dry-run)

- **Slug:** `log`
- **Depends on:** `analyze` (analysis result must be on screen)
- **Expected timing:** <15 seconds

### Steps

1. **Verify prerequisite** — The analysis result from Scenario 2 should still be on screen. If not, SKIP.
2. Find and click the **"Log to Fitbit" button** — use `find` to locate it, then `computer` to click.
3. **Wait for confirmation** — Poll DOM every 3 seconds for up to 15 seconds, looking for text matching `/logged successfully/i`.
4. Verify the **"Done" button** is visible.
5. Click **"Done"** to return to the dashboard.
6. **Navigate to history** — Go to `/app/history`.
7. **Verify the test entry appears** — Use `find` or `get_page_text` to look for "[QA Test]" in the history list. The entry should show the food name from the analysis.

### Pass Criteria

- "Logged successfully" message appears within 15 seconds
- "Done" button is visible and clickable
- Test entry appears in history after navigating to the history page

---

## Scenario 4: Delete Test Entry

- **Slug:** `delete`
- **Depends on:** `log` (test entry must exist in history)
- **Expected timing:** <15 seconds

### Steps

1. **Verify prerequisite** — Should be on the history page with the "[QA Test]" entry visible. If not on history, navigate to `/app/history`. If no "[QA Test]" entry found, SKIP.
2. **Find the test entry** — Use `find` to locate the entry containing "[QA Test]" in the history list.
3. **Open entry detail** — Click on the test entry to open its detail page.
4. **Find the delete action** — Use `find` to look for a delete button or trash icon on the detail page.
5. **Click delete** — Use `computer` to click the delete action.
6. **Handle confirmation** — If a confirmation dialog or prompt appears, confirm the deletion.
7. **Navigate back to history** — Go to `/app/history` (or wait for automatic redirect).
8. **Verify deletion** — Use `find` or `get_page_text` to confirm "[QA Test]" no longer appears in the history list.

### Pass Criteria

- Delete action is found and clickable
- Entry is removed from history after deletion
- No "[QA Test]" entries remain in the history list
