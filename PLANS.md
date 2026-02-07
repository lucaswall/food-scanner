# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-219-accepted-patterns-and-history-detail
**Issues:** FOO-219, FOO-220, FOO-221
**Created:** 2026-02-07
**Last Updated:** 2026-02-07

## Summary

Three improvements: (1) add a nutrition facts detail overlay to the History screen, (2) document accepted code patterns in CLAUDE.md and reviewer prompts to reduce review noise, and (3) add a skipped-findings summary report to the plan-review-implementation skill.

## Issues

### FOO-221: History: tap entry to show nutrition facts in bottom sheet

**Priority:** Medium
**Labels:** Improvement
**Description:** The History screen hides fiber and sodium. Tapping an entry row should open a dialog overlay displaying the full `NutritionFactsCard`. All data is already in `FoodLogHistoryEntry` — no new API calls needed.

**Acceptance Criteria:**
- [ ] Tapping an entry row (anywhere except the delete button) opens a dialog overlay
- [ ] The overlay displays a `NutritionFactsCard` with all fields: food name, amount, unit, calories, protein, carbs, fat, fiber, sodium, meal type
- [ ] The overlay has a close/dismiss mechanism (tap outside, swipe down, or close button)
- [ ] The overlay works well on mobile (44px touch targets)
- [ ] No new API calls needed — all data is already in `FoodLogHistoryEntry`

### FOO-219: Review noise: CLAUDE.md missing guidance on accepted patterns

**Priority:** Low
**Labels:** Convention
**Description:** Reviewers repeatedly flag double casts on Fitbit API responses and string literals in Drizzle test mocks. Both are accepted patterns with valid rationale. Adding documentation to CLAUDE.md and updating reviewer prompts will reduce noise.

**Acceptance Criteria:**
- [ ] CLAUDE.md has a "Known Accepted Patterns" section listing accepted patterns with rationale
- [ ] Reviewer prompts reference this section so reviewers check it before flagging

### FOO-220: Plan-review-implementation: add skipped-findings summary report

**Priority:** Low
**Labels:** Improvement
**Description:** When plan-review-implementation documents MEDIUM/LOW findings as "no fix needed", the reasoning is scattered across iteration sections. Add a consolidated summary at plan completion.

**Acceptance Criteria:**
- [ ] After all iterations reviewed and plan marked COMPLETE, a "Skipped Findings Summary" section is appended
- [ ] The summary table includes: finding, severity, file, rationale for skipping
- [ ] Placed just before the `## Status: COMPLETE` line

## Prerequisites

- [ ] shadcn/ui Dialog component installed (already at `src/components/ui/dialog.tsx`)
- [ ] `NutritionFactsCard` component exists (already at `src/components/nutrition-facts-card.tsx`)
- [ ] `FoodLogHistoryEntry` type includes fiberG and sodiumMg (already in `src/types/index.ts`)

## Implementation Tasks

### Task 1: Add dialog overlay to FoodHistory component

**Issue:** FOO-221
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing tests for dialog behavior:
   - Create test: "tapping an entry row opens a dialog with nutrition facts"
     - Render `FoodHistory`, wait for entries to load
     - Click on the entry row (the `div` wrapping entry content, not the delete button)
     - Assert `NutritionFactsCard` content appears in a dialog: `screen.getByText("Nutrition Facts")`
     - Assert the food's fiber (`2g`) and sodium (`450mg`) are visible
   - Create test: "dialog shows correct data for the clicked entry"
     - Click a different entry, verify its specific nutrition values appear
   - Create test: "clicking delete button does NOT open dialog"
     - Click the delete button, verify dialog does NOT open (no "Nutrition Facts" text)
   - Create test: "dialog can be closed"
     - Open dialog, click close button, verify dialog content disappears
   - Add `ResizeObserver` mock in `beforeAll` (same pattern as `food-analyzer.test.tsx`)
   - Run: `npm test -- food-history`
   - Verify: Tests fail (no dialog functionality exists)

2. **GREEN** - Implement dialog in `food-history.tsx`:
   - Import `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` from `@/components/ui/dialog`
   - Import `NutritionFactsCard` from `@/components/nutrition-facts-card`
   - Add state: `const [selectedEntry, setSelectedEntry] = useState<FoodLogHistoryEntry | null>(null)`
   - Wrap entry row content (excluding delete button) in a clickable `<button>` with `role="button"` and `onClick={() => setSelectedEntry(entry)}`
   - Ensure the entry row click target is at least 44px tall (already is via `p-3`)
   - Add `<Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>` with `<DialogContent>` containing `<NutritionFactsCard>` passing all entry fields
   - Map `FoodLogHistoryEntry` fields to `NutritionFactsCard` props (camelCase to camelCase — they match)
   - Pass `mealTypeId={selectedEntry.mealTypeId}` so meal type shows in the card
   - The delete button already has its own `onClick` — it won't bubble to the row because it's a separate button element outside the clickable area. Restructure the row so the clickable area and delete button are siblings, not nested.
   - Run: `npm test -- food-history`
   - Verify: All tests pass

3. **REFACTOR** - Clean up:
   - Ensure dialog close button has 44px touch target
   - Verify no duplicate food name display (dialog title vs card)
   - Use `DialogTitle` with `className="sr-only"` to satisfy Radix a11y requirement without visual duplication (the card already shows the food name)

**Notes:**
- The `Dialog` component from shadcn/ui already handles overlay dismiss on outside click and has a close X button
- `NutritionFactsCard` is a server component (no `'use client'`) but can be rendered inside a client component
- Reference: `src/components/food-log-confirmation.tsx` for how `NutritionFactsCard` is used with mapped props
- `ResizeObserver` mock is needed for Radix Dialog in tests — see `src/components/__tests__/food-analyzer.test.tsx:7-13`

### Task 2: Add "Known Accepted Patterns" section to CLAUDE.md

**Issue:** FOO-219
**Files:**
- `CLAUDE.md` (modify)

**Steps:**

1. Add a new section "## KNOWN ACCEPTED PATTERNS" after the "## STYLE GUIDE" section in CLAUDE.md
2. Document the two accepted patterns:
   - **Double casts on Fitbit API responses:** `data as unknown as Type` in `src/lib/fitbit.ts` — accepted because critical fields are runtime-validated immediately after the cast (e.g., checking `typeof foodEntry?.foodId !== "number"` before returning)
   - **String literals in Drizzle test mocks:** Using `{ email: "email" }` instead of real Drizzle column objects in test `where()` clauses — accepted because TypeScript catches column name typos at compile time, making additional mock fidelity redundant
3. Keep each entry concise: pattern + file reference + one-line rationale

**Notes:**
- No tests needed — this is documentation only
- Reference: `src/lib/fitbit.ts:170` and `src/lib/fitbit.ts:226` for the double cast pattern

### Task 3: Update reviewer prompts to reference accepted patterns

**Issue:** FOO-219
**Files:**
- `.claude/skills/plan-review-implementation/references/reviewer-prompts.md` (modify)

**Steps:**

1. In the **Common Preamble** section, add a rule: "Read the KNOWN ACCEPTED PATTERNS section in CLAUDE.md before flagging patterns. Do NOT flag patterns that are documented as accepted."
2. In the **Quality Reviewer** section under `TYPE SAFETY`, add: "Before flagging `as unknown as` double casts, check CLAUDE.md KNOWN ACCEPTED PATTERNS — some are intentional with runtime validation."

**Notes:**
- No tests needed — this is skill prompt documentation
- The security and reliability reviewers don't need changes since the flagged patterns are type-safety related

### Task 4: Add skipped-findings summary to plan-review-implementation skill

**Issue:** FOO-220
**Files:**
- `.claude/skills/plan-review-implementation/SKILL.md` (modify)

**Steps:**

1. In the "## After ALL Iterations Reviewed" section, add a new step before the "If all tasks complete and no issues" path:
   - **Collect skipped findings:** Scan all `<!-- REVIEW COMPLETE -->` iteration sections for "Documented (no fix needed)" entries
   - If any exist, append a "## Skipped Findings Summary" section just before `## Status: COMPLETE`
2. Define the summary format:
   ```markdown
   ## Skipped Findings Summary

   Findings documented but not fixed across all review iterations:

   | Severity | Category | File | Finding | Rationale |
   |----------|----------|------|---------|-----------|
   | MEDIUM | EDGE CASE | `src/upload.ts:30` | Unicode filenames not tested | Unlikely in current usage |
   ```
3. Add to the Rules section: "Always append Skipped Findings Summary when documented-only findings exist across any iteration"

**Notes:**
- No tests needed — this is skill configuration
- The summary is only added when there are actually skipped findings (not when all iterations pass clean)

### Task 5: Integration & Verification

**Issue:** FOO-219, FOO-220, FOO-221
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] CLAUDE.md has "Known Accepted Patterns" section with 2 entries
   - [ ] Reviewer prompts reference accepted patterns
   - [ ] plan-review-implementation SKILL.md has skipped-findings summary instructions
   - [ ] food-history.tsx has dialog that opens on entry tap
   - [ ] Dialog shows all nutrition data including fiber and sodium

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-219, FOO-220, FOO-221 to "In Progress" when starting, "Done" when complete |

## Risks & Open Questions

- [ ] Radix Dialog accessibility: The dialog should have a proper title for screen readers. Use `DialogTitle` with `sr-only` class to avoid visual duplication since `NutritionFactsCard` already shows the food name.
- [ ] Dialog animation on mobile: The default shadcn/ui Dialog animates from center. This is acceptable for mobile — a true bottom sheet (Drawer) would require installing `vaul` dependency. The standard Dialog is sufficient for this use case.

## Scope Boundaries

**In Scope:**
- Dialog overlay on history entry tap (FOO-221)
- CLAUDE.md accepted patterns section (FOO-219)
- Reviewer prompt updates (FOO-219)
- Skipped-findings summary in plan-review-implementation (FOO-220)

**Out of Scope:**
- Bottom sheet / drawer pattern (would need new dependency)
- Swipe gestures for dialog dismiss
- Editing nutrition data from the dialog
- Service worker or offline support
