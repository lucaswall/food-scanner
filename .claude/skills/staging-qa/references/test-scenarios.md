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
5. **Test date navigation** — find and click the **previous day arrow** (left arrow / "Previous day" button). Verify the date label changes (no longer says "Today"). Then click the **next day arrow** (right arrow / "Next day" button) to return. Verify "Today" is shown again.
6. Check for **console errors** — call `read_console_messages` with `onlyErrors: true`. Filter out known benign errors (e.g., favicon 404, third-party extension errors like Grammarly).

### Pass Criteria

- Main navigation is visible
- Daily and Weekly tabs are visible and clickable
- Nutrition data renders (at least one calorie value displayed)
- Date navigation works (previous/next day arrows change the displayed date)
- No unexpected console errors

---

## Scenario 2: Weekly View

- **Slug:** `weekly`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app` (the dashboard).
2. Find and click the **"Weekly" tab button**.
3. Wait 2 seconds for data to load.
4. Verify the **weekly view renders** — use `read_page` to check for:
   - A date range display (e.g., "Apr 2 - Apr 8" or similar range format)
   - Average or total calorie data (a number followed by "cal")
   - Daily breakdown bars or rows
5. Click the **"Daily" tab button** to switch back.
6. Verify the daily view renders again (calorie ring or "Today" heading).

### Pass Criteria

- Weekly tab switches the view successfully
- Weekly view shows date range and calorie data
- Switching back to Daily works correctly

---

## Scenario 3: Analyze Food (text-only, real AI)

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
   - Take a screenshot at each poll (for GIF smoothness if recording).
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

## Scenario 4: Refine with Chat

- **Slug:** `refine`
- **Depends on:** none (self-contained — does its own analysis)
- **Expected timing:** 30-90 seconds (two AI interactions)

### Steps

1. Navigate to `/app/analyze`.
2. Find the description textarea and enter using `form_input`: `[QA Test] One banana`
3. Click the **"Analyze Food" button**.
4. **Wait for AI analysis** — SSE polling strategy, 90-second budget, poll every 8 seconds.
5. Verify analysis result appears (food name heading, calorie value).
6. Find and click the **"Refine with chat" button**.
7. Verify the **chat overlay appears** — use `find` to look for a text input with placeholder "Type a message..." or similar.
8. Type a refinement message using `form_input` on the chat input: `Actually it was two bananas, not one`
9. Submit the message — press Enter via `computer` key action, or find and click a send button.
10. **Wait for AI response** — SSE polling, 90-second budget, poll every 8 seconds looking for an updated calorie value or a new message from the assistant.
11. Verify the AI responded — a new message appeared in the chat, or the nutrition values updated.
12. **Navigate away without logging** — click the Home nav link or navigate to `/app` to avoid creating test data.

### Pass Criteria

- Analysis completes and shows nutrition result
- "Refine with chat" opens the chat overlay
- Chat input is functional
- AI responds to the refinement message
- No console errors

**Note:** This scenario does NOT log to Fitbit — it only tests the chat refinement flow. Navigate away to avoid creating entries that need cleanup.

---

## Scenario 5: Log to Fitbit (dry-run)

- **Slug:** `log`
- **Depends on:** `analyze` (analysis result must be on screen)
- **Expected timing:** <15 seconds

### Steps

1. **Verify prerequisite** — The analysis result from the analyze scenario should still be on screen. If not, SKIP.
2. Find and click the **"Log to Fitbit" button** — use `find` to locate it, then `computer` to click.
3. **Wait for confirmation** — Poll DOM every 3 seconds for up to 15 seconds, looking for text matching `/logged successfully/i`.
4. Verify the **"Done" button** is visible.
5. Click **"Done"** to return to the dashboard.
6. **Navigate to history** — Go to `/app/history`.
7. **Verify the test entry appears** — Use `find` or `get_page_text` to look for the food name from the analysis in the history list under "Today".

### Pass Criteria

- "Logged successfully" message appears within 15 seconds
- "Done" button is visible and clickable
- Test entry appears in history after navigating to the history page

---

## Scenario 6: Delete Test Entry

- **Slug:** `delete`
- **Depends on:** `log` (test entry must exist in history)
- **Expected timing:** <15 seconds

### Steps

1. **Verify prerequisite** — Should be on the history page with the test entry visible. If not on history, navigate to `/app/history`. If no test entry found, SKIP.
2. **Find the delete button** — Use `find` to look for the delete button (trash icon) for the test entry.
3. **Click delete** — Use `computer` to click the delete button.
4. **Handle confirmation** — A confirmation dialog will appear ("Delete this entry?"). Find and click the "Confirm" button.
5. Wait 2 seconds for the deletion to process.
6. **Verify deletion** — Use `find` or `get_page_text` to confirm the test entry no longer appears in the history list.

### Pass Criteria

- Delete button is found and clickable
- Confirmation dialog appears and can be confirmed
- Entry is removed from history after deletion

---

## Scenario 7: Quick Select

- **Slug:** `quick-select`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app/quick-select`.
2. Verify the **"Quick Select" heading** is visible.
3. Wait for page to fully load (2-3 seconds for data fetch).
4. Verify **food items are displayed** — use `read_page` or `find` to check for food entry cards. Look for food names, calorie values, or "cal" text. The page shows suggested, recent, and favorite foods.
5. Check that **tab buttons exist** — look for tabs like "Suggested", "Recent", "Favorites" (or similar).
6. Click a different tab (e.g., "Recent" or "Favorites") and verify the content updates.
7. Check for console errors.

### Pass Criteria

- Quick Select heading is visible
- Food items are displayed (at least one entry with name and calories)
- Tab switching works
- No unexpected console errors

---

## Scenario 8: Food Detail Dialog

- **Slug:** `food-detail`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app/history`.
2. Wait for entries to load.
3. Find any food entry in the history list (not a "[QA Test]" entry — use an existing real entry).
4. **Click on the entry** (click the entry card/button, NOT the delete or edit icons).
5. Verify a **detail dialog/sheet opens** — use `find` to look for "Nutrition Facts" heading or a dialog element.
6. Verify the dialog shows **nutrition details** — calories, protein, carbs, fat values.
7. **Close the dialog** — click outside it, press Escape, or find a close button.
8. Verify the dialog closed and the history list is visible again.

### Pass Criteria

- Clicking an entry opens a detail dialog
- Dialog shows "Nutrition Facts" with nutrition values
- Dialog can be closed
- History list is visible after closing

---

## Scenario 9: Edit Entry (real AI)

- **Slug:** `edit`
- **Depends on:** none
- **Expected timing:** 30-90 seconds (AI chat interaction)

### Steps

1. Navigate to `/app/history`.
2. Wait for entries to load.
3. Find an existing entry (not "[QA Test]") and click its **edit button** (pencil icon).
4. Verify the **edit page loads** — use `find` to look for text containing "You logged" and "What would you like to change".
5. Verify the **chat input** is present — look for placeholder "Type a message...".
6. Enter a test message using `form_input`: `[QA Test] Change the portion to 100g`
7. Submit the message — press Enter via `computer` key action.
8. **Wait for AI response** — SSE polling, 90-second budget, poll every 8 seconds. Look for a new assistant message or updated nutrition values.
9. Verify the AI responded with nutrition changes.
10. **Navigate back without saving** — click the "Back" button or navigate to `/app/history`. Do NOT click any save/log button.

### Pass Criteria

- Edit page loads with entry greeting and chat input
- AI responds to the edit request
- Can navigate back without saving
- No console errors

**Note:** This scenario does NOT save changes — it only verifies the edit chat flow works. Navigate away to preserve the original entry.

---

## Scenario 10: Labels Page

- **Slug:** `labels`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app/labels`.
2. Verify the **"Nutrition Labels" heading** is visible.
3. Wait for page content to load (2 seconds).
4. Verify the page renders content — use `read_page` to check for any nutrition label cards or an empty state message. Either is acceptable (depends on whether labels have been saved).
5. Check for console errors.

### Pass Criteria

- "Nutrition Labels" heading is visible
- Page renders without errors (content or empty state)
- No unexpected console errors

---

## Scenario 11: Settings Page

- **Slug:** `settings`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/settings`.
2. Verify a **settings heading** is visible (level 1 heading).
3. Wait for page to fully load (2 seconds).
4. Verify **user session info** is displayed — use `find` or `read_page` to look for the user's email address.
5. Verify **Fitbit status** is displayed — look for text containing "Fitbit:" or "Fitbit" followed by a connection status.
6. Verify **Fitbit App Credentials** section is visible.
7. Scroll down and verify the **API Keys** section and **Claude Usage** section are present.
8. Check for console errors.

### Pass Criteria

- Settings heading visible
- User email displayed
- Fitbit connection status shown
- Fitbit App Credentials section present
- No unexpected console errors

---

## Scenario 12: Chat Page

- **Slug:** `chat`
- **Depends on:** none
- **Expected timing:** <10 seconds (page load only — no AI interaction)

### Steps

1. Navigate to `/app/chat`.
2. Verify the page loads — use `find` to look for a chat input (placeholder "Type a message..." or similar).
3. Verify the page is functional — the input should be interactive and ready for typing.
4. Check for console errors.

### Pass Criteria

- Chat page loads
- Chat input is visible and interactive
- No unexpected console errors

**Note:** This scenario only verifies the standalone chat page loads. It does NOT send a message (that would require a 90s AI wait for low additional coverage over the analyze/refine/edit scenarios that already test AI interaction).
