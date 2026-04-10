# Implementation Plan

**Created:** 2026-04-10
**Source:** Backlog: FOO-956, FOO-957, FOO-958, FOO-959, FOO-960, FOO-961
**Linear Issues:** [FOO-956](https://linear.app/lw-claude/issue/FOO-956/staging-qa-scenario-1-saved-for-later-pass-criterion-fails-when), [FOO-957](https://linear.app/lw-claude/issue/FOO-957/staging-qa-scenario-4-visual-criteria-misrepresents-chat-architecture), [FOO-958](https://linear.app/lw-claude/issue/FOO-958/staging-qa-scenario-11-two-screenshots-contradicts-one-per-scenario), [FOO-959](https://linear.app/lw-claude/issue/FOO-959/staging-qa-coverage-gap-quick-capture-and-process-captures-untested), [FOO-960](https://linear.app/lw-claude/issue/FOO-960/staging-qa-scenarios-10-and-12-provide-minimal-regression-detection), [FOO-961](https://linear.app/lw-claude/issue/FOO-961/staging-qa-coverage-gap-log-sharedtoken-page-untested)
**Branch:** fix/staging-qa-improvements

## Context Gathered

### Codebase Analysis

- **Skill files:** `.claude/skills/staging-qa/SKILL.md` (main skill definition, 322 lines) and `.claude/skills/staging-qa/references/test-scenarios.md` (scenario definitions, 526 lines with 14 scenarios)
- **Current scenario slugs (SKILL.md:129):** `dashboard`, `weekly`, `analyze`, `refine`, `log`, `delete`, `quick-select`, `food-detail`, `edit`, `labels`, `settings`, `chat`, `save`, `log-saved`
- **Report table (SKILL.md:244-257):** Lists 12 scenarios (scenarios 13-14 `save` and `log-saved` are missing from the report template)
- **Screenshot rule (SKILL.md:309):** "One visual assessment screenshot per scenario — minimize token waste, maximize QA value."
- **Seeding failure rule (SKILL.md:110):** "If seeding fails: WARN but continue."

**Referenced application code (verified existence):**
- `src/components/food-analyzer.tsx:560` — Chat renders as `<div className="fixed inset-0 z-[60]">` (full-screen replacement, NOT an overlay)
- `src/app/app/capture/page.tsx` — Quick Capture page, renders `<QuickCapture />` component
- `src/app/app/process-captures/page.tsx` — Process Captures page, renders `<CaptureTriage />` with heading "Process Captures"
- `src/components/quick-capture.tsx` — Camera input, note entry, capture list, IDB storage via `useCaptureSession`
- `src/components/capture-triage.tsx` — States: preview → analyzing → results → saving → done. Redirects to `/app` when no captures.
- `src/app/app/log-shared/[token]/page.tsx` — Shared food page, renders `<LogSharedContent token={token} />`
- `src/app/app/log-shared/[token]/log-shared-content.tsx` — Fetches via `useSWR('/api/shared-food/${token}')`, displays nutrition card + meal type selector + log button
- `src/app/api/shared-food/[token]/route.ts` — API for fetching shared food by token
- `src/app/api/share/route.ts` — API for creating share tokens
- `src/components/nutrition-labels.tsx` — Label list with search, delete dialog, detail sheet. Uses `useSWR('/api/nutrition-labels')`
- `src/components/chat-page-client.tsx` — Standalone chat page with `<FoodChat>` component, height `h-[calc(100dvh-5rem)]`

### MCP Context

- **Linear:** Food Scanner team confirmed. 6 Backlog issues, all staging-qa related. Canceled state UUID: `081ec407-33c9-4a50-894d-e5971f8beff4`.

### Triage Results

**Planned:** FOO-956, FOO-957, FOO-958, FOO-959, FOO-960, FOO-961
**Canceled:** None — all issues are valid and actionable.

## Scope

All changes are to `.claude/skills/staging-qa/` markdown files only. No application source code, no tests, no builds. These are skill definition edits that improve the staging QA automation accuracy and coverage.

**Files modified:**
- `.claude/skills/staging-qa/SKILL.md` (modify)
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)

## Tasks

### Task 1: Fix Scenario 1 "Saved for Later" seed-conditional pass criteria
**Linear Issue:** [FOO-956](https://linear.app/lw-claude/issue/FOO-956/staging-qa-scenario-1-saved-for-later-pass-criterion-fails-when)
**Files:**
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)

**Steps:**
1. In Scenario 1, step 6: Change from unconditional "Verify Saved for Later section" to conditional on seeding success. If seeding succeeded, verify the section shows saved items. If seeding failed or was skipped, verify the section renders correctly (either with existing data or empty state) — do NOT fail on missing seed data.
2. In Scenario 1, pass criteria (line 32): Change `"Saved for Later" section visible with seed data (at least one saved item card)` to a conditional criterion: if seeding succeeded, at least one saved item card is required; if seeding failed, the section rendering at all (content or empty state) is a PASS with WARN.
3. In Scenario 1, visual criteria: Similarly make the "Saved for Later section renders below meals" criterion conditional — when seeding failed, accept empty state rendering.

**Notes:**
- The key insight is that SKILL.md Phase 2 says "If seeding fails: WARN but continue", so downstream scenarios must not hard-FAIL on missing seed data.
- The scenario should still FAIL if seeding succeeded but the section doesn't render — that indicates a real bug.

### Task 2: Fix Scenario 4 visual criteria to match actual chat architecture
**Linear Issue:** [FOO-957](https://linear.app/lw-claude/issue/FOO-957/staging-qa-scenario-4-visual-criteria-misrepresents-chat-architecture)
**Files:**
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)

**Steps:**
1. In Scenario 4, step 12 visual assessment (line 150): Replace "Chat overlay is properly layered over the analysis result" with description of a full-screen chat view (`fixed inset-0`). The chat completely replaces the analysis view — it is NOT layered on top.
2. In Scenario 4, visual criteria section (line 162): Replace "Chat overlay renders cleanly over the result" with criteria about the full-screen chat rendering: back/close button visible, messages area fills the screen, input at the bottom.
3. Keep "Messages are legible at mobile width" and "Input area accessible at bottom of screen" — these remain accurate.

**Notes:**
- Verified in `src/components/food-analyzer.tsx:560`: `<div className="fixed inset-0 z-[60] flex flex-col bg-background">` — this is a full-screen replacement, not an overlay.

### Task 3: Resolve Scenario 11 "two screenshots" contradiction
**Linear Issue:** [FOO-958](https://linear.app/lw-claude/issue/FOO-958/staging-qa-scenario-11-two-screenshots-contradicts-one-per-scenario)
**Files:**
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)

**Steps:**
1. In Scenario 11 (Settings Page), step 8 (line 401): Change "take TWO screenshots (top and bottom after scrolling)" to take ONE screenshot after scrolling to the bottom of the page. The bottom view captures the API Keys and Claude Usage sections, which are the most likely to break. The top sections (session info, Fitbit status) are verified functionally in steps 4-6.
2. This aligns with SKILL.md:309 rule "One visual assessment screenshot per scenario" without needing to add exception language.

**Notes:**
- The Settings page is long and scrollable, but one screenshot (scrolled to show the bottom sections) is sufficient for visual regression detection. The top sections are already verified functionally by `find`/`read_page` in earlier steps.

### Task 4: Enhance Scenarios 10 and 12 with interaction testing
**Linear Issue:** [FOO-960](https://linear.app/lw-claude/issue/FOO-960/staging-qa-scenarios-10-and-12-provide-minimal-regression-detection)
**Files:**
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)

**Steps:**

**Scenario 10 (Labels Page) enhancements:**
1. After step 4 (verify page renders), add: if label cards exist (not empty state), click one label card to open the `NutritionLabelDetailSheet` (verified in `nutrition-labels.tsx:19,29-30`). Verify the detail sheet opens with nutrition data (calories, macros). Close the sheet.
2. Add: test the search input — type a search query using `computer` type action, verify the list filters (or shows no results). Clear the search.
3. Update pass criteria: add "Label detail sheet opens on card click (if labels exist)" and "Search input filters labels".
4. Update visual criteria: add "Label cards show food name and calorie values" and "Detail sheet overlays correctly".

**Scenario 12 (Chat Page) enhancements:**
1. After step 3 (verify input is interactive), add: verify the page has a title or heading (the `<FoodChat>` component renders with `title="Chat"` — look for "Chat" heading). Verify a close/back button exists (the `onClose` handler navigates to `/app`).
2. Add a note explaining the intentional scope: "This scenario intentionally does NOT send a message — AI interaction is already covered by scenarios 3/4/5/9. This tests standalone chat page rendering and navigation."
3. Update pass criteria: add "Chat heading is visible" and "Back/close button is present".

**Notes:**
- `NutritionLabels` component uses `useSWR('/api/nutrition-labels')` and renders cards with `setSelectedLabel`/`setDetailOpen` for the detail sheet.
- `ChatPageClient` renders `<FoodChat title="Chat" onClose={() => router.push("/app")} />`.

### Task 5: Add Scenario 15 — Quick Capture page
**Linear Issue:** [FOO-959](https://linear.app/lw-claude/issue/FOO-959/staging-qa-coverage-gap-quick-capture-and-process-captures-untested)
**Files:**
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)
- `.claude/skills/staging-qa/SKILL.md` (modify — add slug to valid list and report table)

**Steps:**
1. Add new Scenario 15 at the end of `test-scenarios.md` with slug `capture`.
2. Scenario structure:
   - Navigate to `/app/capture`
   - Verify the page loads — look for the capture UI elements (file input for photos, note input area)
   - Verify the capture card list area exists (even if empty — no captures yet)
   - Verify the "Process Captures" navigation or action button exists if applicable
   - Visual assessment screenshot
   - Check for console errors
3. Pass criteria: page loads, capture UI elements visible (file input, note area), no console errors.
4. Visual criteria: capture input area clearly visible, touch targets adequate, mobile layout correct.
5. **Do NOT test Process Captures (`/app/process-captures`)** — it requires actual image data in IndexedDB and redirects to `/app` when no captures exist (`capture-triage.tsx:37-39`). Add a note explaining this limitation.
6. In SKILL.md: add `capture` to the valid slugs list (line 129). Add "Quick Capture" row to the report table.

**Notes:**
- `QuickCapture` component uses `useCaptureSession` hook for IDB storage. The page is primarily a camera/file capture interface.
- `CaptureTriage` (`/app/process-captures`) redirects immediately when `captures.length === 0` (line 37-39). Cannot be meaningfully tested without pre-populated IDB data.

### Task 6: Add Scenario 16 — Shared Food page
**Linear Issue:** [FOO-961](https://linear.app/lw-claude/issue/FOO-961/staging-qa-coverage-gap-log-sharedtoken-page-untested)
**Files:**
- `.claude/skills/staging-qa/references/test-scenarios.md` (modify)
- `.claude/skills/staging-qa/SKILL.md` (modify — add slug to valid list and report table)

**Steps:**
1. Add new Scenario 16 at the end of `test-scenarios.md` with slug `share`.
2. Scenario structure:
   - **Create share token:** Use `javascript_tool` to call the share API from the browser: `fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ food_log_entry_id: <id> }) })`. To get an entry ID, first query via `psql` against staging DB for a recent `food_log_entries` row (seed data or existing).
   - If no food log entries exist, SKIP with reason "no food log entries available for sharing".
   - Navigate to `/app/log-shared/<token>` with the generated token.
   - Verify the page loads — look for a food name heading (`<h1>`) and "Shared food" subtitle.
   - Verify nutrition data renders — look for the `NutritionFactsCard` content (calories, protein, carbs, fat).
   - Verify the "Log to Fitbit" or "Log as new food" button is visible.
   - Verify the `MealTypeSelector` is present (meal type dropdown/selector).
   - Visual assessment screenshot.
   - Check for console errors.
   - **Do NOT click log** — this tests page rendering, not the logging flow (already tested in scenario 5).
3. Pass criteria: share token created successfully, page loads with food name and nutrition data, log button visible, no console errors.
4. Visual criteria: nutrition card readable, log button has adequate touch target, meal type selector visible, mobile layout correct.
5. In SKILL.md: add `share` to the valid slugs list (line 129). Add "Shared Food" row to the report table.

**Notes:**
- `LogSharedContent` fetches via `useSWR('/api/shared-food/${token}')` and displays nutrition data + log button.
- The share API (`/api/share`) creates a token from an existing food log entry ID.
- This scenario depends on having at least one food log entry. If seeding failed and no prior scenarios created entries, it should SKIP gracefully.

### Task 7: Update SKILL.md report template and slug list
**Linear Issue:** All issues (comprehensive SKILL.md update)
**Files:**
- `.claude/skills/staging-qa/SKILL.md` (modify)

**Steps:**
1. **Slug list (line 129):** Add `capture` and `share` to the valid slugs. Updated list: `dashboard, weekly, analyze, refine, log, delete, quick-select, food-detail, edit, labels, settings, chat, save, log-saved, capture, share`.
2. **Report table (lines 244-257):** Add missing rows for scenarios 13-14 (`save`, `log-saved`) and new scenarios 15-16 (`capture`, `share`). The table currently only lists 12 scenarios but there should be 16. Add rows:
   - `| Save for Later | PASS/FAIL/SKIP | OK/WARN | |`
   - `| Log saved food | PASS/FAIL/SKIP | OK/WARN | |`
   - `| Quick Capture | PASS/FAIL/SKIP | OK/WARN | |`
   - `| Shared Food | PASS/FAIL/SKIP | OK/WARN | |`
3. Verify the summary line `**Summary:** X/Y passed` will correctly reflect 16 total scenarios.

**Notes:**
- This task consolidates all SKILL.md changes. If implementing sequentially, tasks 5 and 6 can skip their SKILL.md changes and defer to this task.
- Depends on Tasks 5 and 6 being finalized (slug names confirmed).

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for consistency between SKILL.md and test-scenarios.md
2. Run `verifier` agent — Verify lint and build pass (ensure no application code was accidentally modified)

---

## Plan Summary

**Objective:** Fix contradictions and coverage gaps in the staging-qa skill — 3 bug/accuracy fixes to existing scenarios, 1 enhancement to weak scenarios, and 2 new scenarios for untested pages.
**Linear Issues:** FOO-956, FOO-957, FOO-958, FOO-959, FOO-960, FOO-961
**Approach:** Edit `.claude/skills/staging-qa/SKILL.md` and `references/test-scenarios.md` to fix seed-conditional pass criteria (FOO-956), correct chat architecture description (FOO-957), resolve screenshot contradiction (FOO-958), enhance weak scenarios 10/12 with interactions (FOO-960), and add new scenarios for Quick Capture (FOO-959) and Shared Food (FOO-961) pages.
**Scope:** 7 tasks, 2 files, 0 tests (skill markdown files only — no application code changes)
**Key Decisions:**
- Settings page: reduce to 1 screenshot (bottom-scrolled) rather than adding exception language
- Quick Capture: test `/app/capture` only — `/app/process-captures` is impractical without IDB data injection
- Shared Food: create share token via API during scenario, skip if no food log entries exist
- Chat page (Scenario 12): keep as smoke test with enhanced checks, intentionally no AI interaction
**Risks:**
- Share scenario (16) depends on food log entries existing — may SKIP if seeding failed and no prior scenarios created entries
- Capture scenario (15) is limited to page-load + UI element verification since camera input can't be meaningfully automated
