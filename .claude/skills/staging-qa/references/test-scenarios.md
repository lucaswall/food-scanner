# Test Scenarios

## Scenario 1: Dashboard Loads

- **Slug:** `dashboard`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app` (the dashboard).
2. Wait for page to fully load — use `find` to look for "Main navigation" (role: navigation).
3. Verify the **Daily/Weekly tab buttons** are visible — use `find` to look for "Daily" and "Weekly" buttons.
4. Verify **calorie/nutrition data renders** — use `find` to check for numeric content in the nutrition summary area (any number followed by "cal" or "kcal"). With seeded data, expect non-zero calorie values for today.
5. **Test date navigation** — find and click the **previous day arrow** (left arrow / "Previous day" button). Verify the date label changes (no longer says "Today"). Then click the **next day arrow** (right arrow / "Next day" button) to return. Verify "Today" is shown again.
6. **Verify "Saved for Later" section** — use `find` to look for text "Saved for Later". With seed data, expect a section showing 2 saved items with food names and calorie values. Verify at least one card is visible (e.g., containing "chicken" or "banana" text).
7. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Calorie ring/progress indicator renders with data (not empty/zero if seed data is present)
   - Macro bars (protein, carbs, fat) are visible with values
   - Meal entries appear in the daily view (breakfast/lunch cards)
   - Saved for Later section renders below meals with food names and calorie values
   - Navigation bar at bottom is fully visible and not cut off
   - No overlapping elements or broken layout at 390px width
8. Check for **console errors** — call `read_console_messages` with `onlyErrors: true`. Filter out known benign errors (e.g., favicon 404, third-party extension errors like Grammarly).

### Pass Criteria

- Main navigation is visible
- Daily and Weekly tabs are visible and clickable
- Nutrition data renders (at least one calorie value displayed)
- Date navigation works (previous/next day arrows change the displayed date)
- "Saved for Later" section visible with seed data (at least one saved item card)
- No unexpected console errors

### Visual Criteria

- Calorie ring shows progress (if seed data present)
- Macro progress bars render correctly
- Saved for Later section renders below meals with food names and calorie values
- Page fits mobile viewport without horizontal scroll
- Bottom nav bar fully visible with all 5 items

---

## Scenario 2: Weekly View

- **Slug:** `weekly`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app` (the dashboard).
2. Find and click the **"Weekly" tab button**.
3. Wait 2 seconds for data to load.
4. Verify the **weekly view renders** — use `find` to check for:
   - A date range display (e.g., "Apr 2 - Apr 8" or similar range format)
   - With seeded data: calorie data per day (numbers followed by "cal")
   - Daily breakdown bars or rows (Sun-Sat)
5. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Weekly bars/chart shows varying heights across days (seeded data has different totals per day)
   - Date range header is legible and correctly formatted
   - Day labels (Sun-Sat) are all visible and not truncated
   - No "Log food for a few days" empty state (if seed data present)
6. Click the **"Daily" tab button** to switch back.
7. Verify the daily view renders again (calorie ring or "Today" heading).

### Pass Criteria

- Weekly tab switches the view successfully
- Weekly view shows date range
- With seeded data: calorie data appears for multiple days
- Switching back to Daily works correctly

### Visual Criteria

- Weekly chart/bars render with data (not empty state, if seeded)
- All 7 days visible without horizontal scroll
- Chart proportions look reasonable (bars have varying heights)

---

## Scenario 3: Analyze Food (text-only, real AI)

- **Slug:** `analyze`
- **Depends on:** none
- **Expected timing:** 15-45 seconds (real AI analysis)

### Steps

1. Navigate to `/app/analyze`.
2. Verify the **"Analyze Food" heading** is visible — use `find` to look for heading with text "Analyze Food".
3. Find the **description textarea** — use `find` to look for a textarea (placeholder contains "e.g."), then click it with `computer`.
4. Enter test text using `computer` type action: `[QA Test] Two scrambled eggs with toast` (do NOT use `form_input` — it doesn't trigger React onChange handlers).
5. Click somewhere neutral (empty area) to deselect the textarea, then find and click the **"Analyze Food" button**. If the ref-based click doesn't trigger submission (page stays unchanged after 3 seconds), fall back to `javascript_tool`: `document.querySelectorAll('button').forEach(b => { if (b.textContent.trim() === 'Analyze Food') b.click() })`.
6. **Wait for AI analysis** using the SSE polling strategy:
   - Set a timer: 90 seconds total budget.
   - Every 8 seconds, call `find` looking for either:
     - A food name heading in the results area (indicates analysis complete)
     - A calorie number (e.g., text matching a number followed by "cal")
     - An error message or error toast (indicates analysis failed — fail fast)
   - If 90 seconds elapse with no result → FAIL with "AI analysis timed out after 90 seconds".
7. **Verify the analysis result:**
   - A food name heading appeared (should contain something related to "eggs" or "toast" or the food described)
   - A calorie value is displayed and is a reasonable number (50-2000 range)
   - A **"Log to Fitbit"** button is visible
8. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Food name heading is legible and not truncated
   - Nutrition card layout is clean (calories, macros displayed in a structured format)
   - Action buttons (Log to Fitbit, Refine with chat) are fully visible
   - No overlapping content or broken card layout
9. Check for console errors.

### Pass Criteria

- Analysis completes within 90 seconds
- Food name heading appears
- Calorie value is displayed and in a reasonable range (50-2000)
- "Log to Fitbit" button is visible
- No unexpected console errors

### Visual Criteria

- Nutrition result card is well-structured
- All action buttons visible without scrolling
- Text is legible at mobile width

---

## Scenario 4: Refine with Chat

- **Slug:** `refine`
- **Depends on:** none (self-contained — does its own analysis)
- **Expected timing:** 30-90 seconds (two AI interactions)

### Steps

1. Navigate to `/app/analyze`.
2. Find the description textarea, click it, and type using `computer` type action: `[QA Test] One banana`
3. Click the **"Analyze Food" button** (same fallback as Scenario 3 if ref-click doesn't work).
4. **Wait for AI analysis** — SSE polling strategy, 90-second budget, poll every 8 seconds.
5. Verify analysis result appears (food name heading, calorie value).
6. Find and click the **"Refine with chat" button**.
7. Verify the **chat overlay appears** — use `find` to look for a text input with placeholder "Type a message..." or similar.
8. Type a refinement message using `computer` type action on the chat input: `Actually it was two bananas, not one`
9. Submit the message — press Enter via `computer` key action, or find and click a send button.
10. **Wait for AI response** — SSE polling, 90-second budget, poll every 8 seconds looking for an updated calorie value or a new message from the assistant.
11. Verify the AI responded — a new message appeared in the chat, or the nutrition values updated.
12. **Visual assessment screenshot** — take a screenshot and evaluate:
    - Chat overlay is properly layered over the analysis result
    - Messages are readable (user message and AI response both visible)
    - Chat input is visible at the bottom and not covered by the keyboard or other elements
    - Nutrition values area still visible or accessible
### Pass Criteria

- Analysis completes and shows nutrition result
- "Refine with chat" opens the chat overlay
- Chat input is functional
- AI responds to the refinement message
- No console errors

### Visual Criteria

- Chat overlay renders cleanly over the result
- Messages are legible at mobile width
- Input area accessible at bottom of screen

**Note:** This scenario does NOT log to Fitbit — it only tests the chat refinement flow.

---

## Scenario 5: Log to Fitbit (dry-run)

- **Slug:** `log`
- **Depends on:** none (self-contained — does its own analysis)
- **Expected timing:** 20-50 seconds (AI analysis + log)

### Steps

1. Navigate to `/app/analyze`.
2. Find the description textarea, click it, and type using `computer` type action: `[QA Test] Plain rice 200g`
3. Click the **"Analyze Food" button** (same fallback as Scenario 3 if ref-click doesn't work).
4. **Wait for AI analysis** — SSE polling strategy, 90-second budget, poll every 8 seconds.
5. Verify analysis result appears (food name heading, calorie value).
6. Find and click the **"Log as new food" button** (staging uses dry-run mode, so the button may say "Log as new food" or "Log to Fitbit") — use `find` to locate it, then `computer` to click.
7. **Wait for confirmation** — Poll DOM every 3 seconds for up to 15 seconds, looking for text matching `/logged successfully/i`.
8. Verify the **"Done" button** is visible.
9. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Success message is prominent and readable
   - Done button is clearly visible and tappable
   - No error messages or broken layout
10. Click **"Done"** to return to the dashboard.
11. **Navigate to history** — Go to `/app/history`.
12. **Verify the test entry appears** — Use `find` or `get_page_text` to look for the food name from the analysis in the history list under "Today".

### Pass Criteria

- AI analysis completes
- "Logged successfully" message appears within 15 seconds
- "Done" button is visible and clickable
- Test entry appears in history after navigating to the history page

### Visual Criteria

- Success state is clearly communicated visually
- Done button has adequate touch target

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

### Visual Criteria

- Confirmation dialog is centered and readable
- Dialog buttons have adequate touch targets

**Note:** This scenario tests the UI delete flow. DB cleanup in Phase 5 handles leftover seed/test data separately.

---

## Scenario 7: Quick Select

- **Slug:** `quick-select`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app/quick-select`.
2. Verify the **"Quick Select" heading** is visible.
3. Wait for page to fully load (2-3 seconds for data fetch).
4. Verify **food items are displayed** — use `find` to check for food entry cards. Look for food names, calorie values, or "cal" text. The page shows suggested, recent, and favorite foods.
5. Check that **tab buttons exist** — look for tabs like "Suggested", "Recent", "Favorites" (or similar).
6. Click a different tab (e.g., "Recent" or "Favorites") and verify the content updates.
7. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Food cards are evenly spaced and not overlapping
   - Calorie values are aligned and readable
   - Tab buttons are all visible and the active tab is distinguishable
   - Cards don't overflow the viewport width
8. Check for console errors.

### Pass Criteria

- Quick Select heading is visible
- Food items are displayed (at least one entry with name and calories)
- Tab switching works
- No unexpected console errors

### Visual Criteria

- Food cards have consistent layout
- Active tab clearly indicated
- Content fits mobile viewport

---

## Scenario 8: Food Detail Dialog

- **Slug:** `food-detail`
- **Depends on:** none
- **Expected timing:** <10 seconds

### Steps

1. Navigate to `/app/history`.
2. Wait for entries to load.
3. Find any food entry in the history list (not a "[QA Test]" or "[QA Seed]" entry — use an existing real entry, or a seed entry if no real ones exist).
4. **Click on the entry** (click the entry card/button, NOT the delete or edit icons).
5. Verify a **detail dialog/sheet opens** — use `find` to look for "Nutrition Facts" heading or a dialog element.
6. Verify the dialog shows **nutrition details** — calories, protein, carbs, fat values.
7. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Dialog/sheet is properly overlaying the page
   - Nutrition Facts label is styled correctly (resembles a nutrition label)
   - All macro values (calories, protein, carbs, fat) are displayed with units
   - Dialog fits within the mobile viewport
8. **Close the dialog** — click outside it, press Escape, or find a close button.
9. Verify the dialog closed and the history list is visible again.

### Pass Criteria

- Clicking an entry opens a detail dialog
- Dialog shows "Nutrition Facts" with nutrition values
- Dialog can be closed
- History list is visible after closing

### Visual Criteria

- Dialog overlays correctly (not full-page redirect)
- Nutrition label format is clean and readable
- Close mechanism is intuitive

---

## Scenario 9: Edit Entry (real AI)

- **Slug:** `edit`
- **Depends on:** none
- **Expected timing:** 30-90 seconds (AI chat interaction)

### Steps

1. Navigate to `/app/history`.
2. Wait for entries to load.
3. Find an existing entry (not "[QA Test]" or "[QA Seed]") and click its **edit button** (pencil icon). If only seed entries exist, use one of those.
4. Verify the **edit page loads** — use `find` to look for text containing "You logged" and "What would you like to change".
5. Verify the **chat input** is present — look for placeholder "Type a message...".
6. Enter a test message using `computer` type action: `[QA Test] Change the portion to 100g`
7. Submit the message — press Enter via `computer` key action.
8. **Wait for AI response** — SSE polling, 90-second budget, poll every 8 seconds. Look for a new assistant message or updated nutrition values.
9. Verify the AI responded with nutrition changes.
10. **Visual assessment screenshot** — take a screenshot and evaluate:
    - Chat messages are formatted and readable
    - AI response includes structured nutrition data
    - Chat input remains accessible at the bottom
    - Page scrolls properly if content is long
11. **Navigate back without saving** — click the "Back" button or navigate to `/app/history`. Do NOT click any save/log button.

### Pass Criteria

- Edit page loads with entry greeting and chat input
- AI responds to the edit request
- Can navigate back without saving
- No console errors

### Visual Criteria

- Chat messages formatted cleanly
- Nutrition changes clearly presented
- Navigation back is accessible

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
5. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Heading is properly styled
   - Content or empty state renders cleanly
   - No broken layout or unstyled elements
   - Navigation bar is visible at bottom
6. Check for console errors.

### Pass Criteria

- "Nutrition Labels" heading is visible
- Page renders without errors (content or empty state)
- No unexpected console errors

### Visual Criteria

- Page layout is clean (content or empty state)
- Navigation bar visible

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
8. **Visual assessment screenshot** — take TWO screenshots (top and bottom after scrolling) and evaluate:
   - Session info card is well-structured
   - Fitbit connection badge/status is clearly visible
   - Sections are properly separated and labeled
   - Form fields (credentials) are properly laid out
   - API Keys and Claude Usage sections render at the bottom
9. Check for console errors.

### Pass Criteria

- Settings heading visible
- User email displayed
- Fitbit connection status shown
- Fitbit App Credentials section present
- No unexpected console errors

### Visual Criteria

- All sections properly laid out and separated
- Form fields properly sized for mobile
- Scrollable content accessible

---

## Scenario 12: Chat Page

- **Slug:** `chat`
- **Depends on:** none
- **Expected timing:** <10 seconds (page load only — no AI interaction)

### Steps

1. Navigate to `/app/chat`.
2. Verify the page loads — use `find` to look for a chat input (placeholder "Type a message..." or similar).
3. Verify the page is functional — the input should be interactive and ready for typing.
4. **Visual assessment screenshot** — take a screenshot and evaluate:
   - Chat input is positioned at the bottom of the screen
   - Page has appropriate empty state or welcome message
   - Input area has adequate touch target
   - No broken layout elements
5. Check for console errors.

### Pass Criteria

- Chat page loads
- Chat input is visible and interactive
- No unexpected console errors

### Visual Criteria

- Chat input properly positioned
- Empty state or welcome content renders
- Mobile-friendly layout

**Note:** This scenario only verifies the standalone chat page loads. It does NOT send a message (that would require a 90s AI wait for low additional coverage over the analyze/refine/edit scenarios that already test AI interaction).

---

## Scenario 13: Save for Later

- **Slug:** `save`
- **Depends on:** none (self-contained)
- **Expected timing:** 20-50 seconds (AI analysis + save)

### Steps

1. Navigate to `/app/analyze`.
2. Find the description textarea, click it, and type using `computer` type action: `[QA Test] Apple with peanut butter`
3. Click the **"Analyze Food" button** (same fallback as Scenario 3 if ref-click doesn't work).
4. **Wait for AI analysis** — SSE polling strategy, 90-second budget, poll every 8 seconds looking for a food name heading or calorie value.
5. Verify analysis result appears (food name heading, calorie value).
6. Find and click the **"Save for Later" button** — use `find` to locate a button containing "Save for Later" text.
7. **Wait for save confirmation** — Poll every 3 seconds for up to 15 seconds looking for either:
   - A "Saved" text (toast/banner)
   - Navigation to the dashboard (URL changes to `/app`)
8. Verify navigation to dashboard occurred.
9. Verify **"Saved for Later" section** on dashboard contains the saved item — use `find` to look for text containing "Apple" or "peanut butter" within the Saved for Later section.
10. **Visual assessment screenshot** — take a screenshot and evaluate the dashboard with the newly saved item visible.

### Pass Criteria

- Analysis completes within 90 seconds
- "Save for Later" button is visible and clickable in post-analysis UI
- Save succeeds (toast/banner or navigation)
- Item appears on dashboard in the "Saved for Later" section
- No unexpected console errors

### Visual Criteria

- Save button visible in post-analysis action buttons
- Dashboard "Saved for Later" section shows the saved item with food name and calories

---

## Scenario 14: Log Saved Food

- **Slug:** `log-saved`
- **Depends on:** `save` (Scenario 13)
- **Expected timing:** <15 seconds (no AI interaction)

### Steps

1. Should be on the dashboard with the saved item visible. If not, navigate to `/app`.
2. Find and click the **saved item card** in the "Saved for Later" section — look for text containing "Apple" or "peanut butter" and click it.
3. Verify the **detail page loads** — use `find` to look for nutrition data (calories, protein) and a "Log to Fitbit" or "Log as new food" button.
4. **Visual assessment screenshot** — take a screenshot of the detail page BEFORE logging (to capture the layout).
5. Find and click the **log button** — use `find` to locate "Log to Fitbit" or "Log as new food" button.
6. **Wait for confirmation** — Poll every 3 seconds for up to 15 seconds looking for "logged successfully" text.
7. Verify the **"Done" button** is visible, then click it.
8. Navigate to the dashboard (`/app`).
9. Verify the **"Saved for Later" section** no longer contains the logged item (look for "Apple" or "peanut butter" — should NOT be found). If the section is hidden entirely (no saved items left), that also passes.

### Pass Criteria

- Detail page loads with nutrition data
- Log button is visible and clickable
- Log succeeds ("logged successfully" message)
- Item removed from dashboard "Saved for Later" section after logging
- No unexpected console errors

### Visual Criteria

- Detail page layout is clean: nutrition card readable, action buttons visible
- Meal type and time selectors are present
- Sticky bottom CTA button is fully visible
