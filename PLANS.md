# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-604-high-priority-batch
**Issues:** FOO-604, FOO-605, FOO-609, FOO-610, FOO-645, FOO-648
**Created:** 2026-02-18
**Last Updated:** 2026-02-18

## Summary

Implement 6 high-priority backlog fixes across chat accessibility, empty/error states, Claude prompt behavior, and analysis narrative preservation. These span `food-chat.tsx`, `food-detail.tsx`, `food-history.tsx`, `claude.ts`, `food-analyzer.tsx`, and `analysis-result.tsx`.

## Issues

### FOO-604: Chat messages area has no aria-live region

**Priority:** High
**Labels:** Bug
**Description:** The messages scroll container in `food-chat.tsx:583-586` has no `aria-live` or `role="log"`. Screen reader users receive no announcement when new messages appear.

**Acceptance Criteria:**
- [ ] New chat messages are announced to screen readers
- [ ] AI streaming responses are announced as they complete
- [ ] Announcements don't replay entire conversation history

### FOO-605: Chat text input has no accessible label

**Priority:** High
**Labels:** Bug
**Description:** The `<Input>` at `food-chat.tsx:782` has `placeholder="Type a message..."` but no `aria-label`. When the user types, the placeholder disappears and the field becomes unlabeled.

**Acceptance Criteria:**
- [ ] Chat input has a persistent accessible name via `aria-label`
- [ ] Screen readers announce the field purpose regardless of content state

### FOO-609: History empty state — no icon, no CTA, blank screen

**Priority:** High
**Labels:** Improvement
**Description:** `food-history.tsx:223-229` shows two lines of muted text and 75% blank screen. No icon, no action buttons. Compare to `daily-dashboard.tsx:254-273` which has icon + "Scan Food" / "Quick Select" buttons.

**Acceptance Criteria:**
- [ ] Empty state has a visual icon
- [ ] "Scan Food" and "Quick Select" action buttons present
- [ ] Empty state looks intentional and designed, not broken

### FOO-610: Food detail error state — minimal feedback, no retry

**Priority:** High
**Labels:** Improvement
**Description:** `food-detail.tsx:50-65` shows a plain "Back" button and red text "Failed to load food entry details". No retry, no icon, no card structure.

**Acceptance Criteria:**
- [ ] Error state has a visual error icon
- [ ] Retry button present and functional
- [ ] Error message wrapped in a card/container for visual structure
- [ ] "Go back" link available as fallback

### FOO-645: Claude asks unnecessary text confirmation before logging food from history

**Priority:** High
**Labels:** Bug
**Description:** Claude asks "Queres que lo registre?" when the user names a food to log, instead of calling `report_nutrition` immediately. Root causes in `src/lib/claude.ts`:
1. `CHAT_SYSTEM_PROMPT` (line 60) has anti-confirmation rule but narrow examples
2. Neither prompt explains that `report_nutrition` surfaces a UI card — it doesn't log directly
3. `ANALYSIS_SYSTEM_PROMPT` (line 425) has NO anti-confirmation rule

**Acceptance Criteria:**
- [ ] Both `CHAT_SYSTEM_PROMPT` and `ANALYSIS_SYSTEM_PROMPT` have anti-confirmation rules
- [ ] Both prompts explain that `report_nutrition` surfaces a UI card with a "Log to Fitbit" button
- [ ] Examples broadened to cover: naming food from list, responding to "Queres registrar algo?" with a food name, single-word food references
- [ ] Existing unit tests for prompt content updated

### FOO-648: AI analysis narrative lost after analysis completes — broken markdown during loading

**Priority:** High
**Labels:** Improvement
**Description:** Two related issues: (1) `text_delta` events stream as raw text in `analysis-result.tsx:39-41` — markdown renders broken. (2) When `analysis` event fires, the narrative is permanently cleared (`food-analyzer.tsx:296` sets `loadingStep(undefined)`). The `needs_chat` path preserves text correctly via `seedMessages` + `ChatMarkdown` — only the happy path has this gap.

**Acceptance Criteria:**
- [ ] `text_delta` text no longer shown as raw broken markdown during loading
- [ ] Tool status messages ("Searching web...", etc.) still shown during loading
- [ ] Accumulated narrative preserved when analysis completes
- [ ] Narrative displayed below nutrition grid using `ChatMarkdown` for proper rendering
- [ ] Narrative section collapsed by default, expandable by user
- [ ] Section hidden if narrative is empty or trivially short (<20 chars)
- [ ] Narrative reset when analysis state is reset

## Prerequisites

- [ ] On `main` branch, clean working tree
- [ ] `npm install` up to date

## Implementation Tasks

### Task 1: Add aria-label to chat input (FOO-605)

**Issue:** FOO-605
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test in `food-chat.test.tsx` that asserts the chat text input has `aria-label="Message"`. Query by role `textbox` and assert `toHaveAttribute("aria-label", "Message")`.
   - Run: `npm test -- food-chat`
   - Verify: Test fails (no aria-label present)

2. **GREEN** — Add `aria-label="Message"` to the `<Input>` at `food-chat.tsx:782`.
   - Run: `npm test -- food-chat`
   - Verify: Test passes

**Notes:**
- Single attribute addition. No structural changes needed.

### Task 2: Add aria-live region to chat messages (FOO-604)

**Issue:** FOO-604
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test that asserts the messages scroll container has `role="log"` and `aria-live="polite"`. The container is identified by `ref={scrollContainerRef}` which can be queried by its role.
   - Run: `npm test -- food-chat`
   - Verify: Test fails

2. **GREEN** — Add `role="log"` and `aria-live="polite"` to the scroll container div at `food-chat.tsx:583-586`. Also add `aria-atomic="false"` so each new message is announced incrementally rather than replaying the entire history.
   - Run: `npm test -- food-chat`
   - Verify: Test passes

**Notes:**
- `role="log"` implies `aria-live="polite"` per ARIA spec, but adding both explicitly ensures compatibility with all screen readers.
- `aria-atomic="false"` is critical — without it, some screen readers re-read the entire log region on each update.

### Task 3: Add CTA buttons and icon to history empty state (FOO-609)

**Issue:** FOO-609
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests for the empty state:
   - Test that an icon element is rendered (e.g., by test-id or accessible name)
   - Test that a "Scan Food" link to `/app/analyze` is present
   - Test that a "Quick Select" link to `/app/quick-select` is present
   - Run: `npm test -- food-history`
   - Verify: Tests fail (current empty state is just text)

2. **GREEN** — Replace the empty state at `food-history.tsx:223-229`:
   - Add a lucide icon above the text (use `UtensilsCrossed` or `CalendarX2` — pick whichever fits the "no food logged" semantic)
   - Add `<Button asChild variant="outline">` wrapped `<Link>` components for "Scan Food" (`/app/analyze`) and "Quick Select" (`/app/quick-select`), matching the pattern in `daily-dashboard.tsx:258-271`
   - Import `Link` from `next/link`, `Button` from `@/components/ui/button`, and the chosen icon from `lucide-react`
   - Run: `npm test -- food-history`
   - Verify: Tests pass

**Notes:**
- Follow the `daily-dashboard.tsx:254-273` empty state pattern exactly: centered flex column, icon, text, then button row with gap-3.
- Use `<Button asChild variant="outline">` rather than hardcoded className strings (FOO-618 is about fixing the hardcoded pattern in daily-dashboard itself).
- Both buttons need `min-h-[44px]` for touch targets.

### Task 4: Improve food detail error state (FOO-610)

**Issue:** FOO-610
**Files:**
- `src/components/food-detail.tsx` (modify)
- `src/components/__tests__/food-detail.test.tsx` (create — no existing test file)

**TDD Steps:**

1. **RED** — Create `src/components/__tests__/food-detail.test.tsx`:
   - Mock `next/navigation` (`useRouter` returning `{ back: vi.fn() }`)
   - Mock `swr` to return `{ data: undefined, error: new Error("fetch failed"), isLoading: false }`
   - Test 1: Error state renders an error icon (query by test-id `error-icon`)
   - Test 2: Error state has a retry button (`role="button"` with name "Try again" or "Retry")
   - Test 3: Retry button calls `mutate()` from SWR to refetch
   - Test 4: "Go back" button is still present
   - Test 5: Error message is inside a styled card container (query parent has appropriate classes)
   - Run: `npm test -- food-detail`
   - Verify: Tests fail

2. **GREEN** — Rewrite the error branch at `food-detail.tsx:50-65`:
   - Wrap content in a card/container with `bg-destructive/10 border border-destructive/20 rounded-lg p-6`
   - Add a lucide `AlertCircle` icon above the message
   - Change the plain text to be more helpful: "Something went wrong loading this food entry."
   - Add a "Try again" `<Button>` that calls SWR's `mutate()` to refetch (destructure `mutate` from `useSWR`)
   - Keep the existing "Back" button below as fallback
   - Run: `npm test -- food-detail`
   - Verify: Tests pass

**Notes:**
- `useSWR` already returns `mutate` — just destructure it alongside `data`, `error`, `isLoading`.
- Follow the error state pattern from `analysis-result.tsx:46-57` (centered column, icon, text, button).

### Task 5: Strengthen anti-confirmation rules in Claude prompts (FOO-645)

**Issue:** FOO-645
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests in `claude.test.ts`:
   - Test that `CHAT_SYSTEM_PROMPT` contains text explaining `report_nutrition` surfaces a UI card, not a direct log
   - Test that `ANALYSIS_SYSTEM_PROMPT` contains an anti-confirmation rule (asserting it includes a substring like "never ask" or "do not ask" + "confirmation")
   - Test that `ANALYSIS_SYSTEM_PROMPT` explains `report_nutrition` surfaces a UI card
   - Run: `npm test -- claude.test`
   - Verify: Tests fail (ANALYSIS_SYSTEM_PROMPT has no such rules)

2. **GREEN** — Modify both system prompts in `claude.ts`:

   **In `CHAT_SYSTEM_PROMPT`** (around lines 48-61):
   - Add context to `report_nutrition` tool description area: explain that calling `report_nutrition` surfaces a UI card with nutrition details and a "Log to Fitbit" button — it does NOT log food directly. The user must tap "Log to Fitbit" to actually commit the food log. Therefore, text confirmation before `report_nutrition` is never necessary.
   - Broaden the existing anti-confirmation rule at line 60: expand examples beyond "comi eso" / "registra eso" to include: naming a food from a displayed list, responding to "Queres registrar algo?" with a food name, any single food reference in context where the conversation establishes logging intent.
   - Add blanket rule: "Never ask 'should I log/register this?' — always call report_nutrition and let the user confirm via the UI button."

   **In `ANALYSIS_SYSTEM_PROMPT`** (around line 425-442):
   - Add the same `report_nutrition` UI card explanation
   - Add anti-confirmation rule: "When the food is clearly described or photographed, call report_nutrition immediately. Never ask for confirmation before calling report_nutrition — the user confirms via the UI button."
   - Run: `npm test -- claude.test`
   - Verify: Tests pass

3. **REFACTOR** — Extract shared anti-confirmation text into a const if both prompts use identical wording, to keep them in sync.

**Notes:**
- The existing `REPORT_NUTRITION_TOOL.description` at line 81 says "Report the nutritional analysis of the food" — this is what Claude reads. Adding the UI card context to the system prompt (not the tool description) is the right approach, since tool descriptions are tightly scoped.
- Verify existing prompt tests still pass — check `claude.test.ts` for any hardcoded string assertions that might break.

### Task 6: Accumulate narrative text and stop showing text_delta during loading (FOO-648 — Part 1: food-analyzer.tsx)

**Issue:** FOO-648
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests in `food-analyzer.test.tsx`:
   - Test: When SSE stream emits `text_delta` events followed by an `analysis` event, the analysis result component receives a `narrative` prop containing the accumulated text delta content
   - Test: During loading, `loadingStep` is NOT set from `text_delta` events (only from `tool_start` events)
   - Test: `tool_start` events still set `loadingStep` correctly (e.g., "Searching web...")
   - Test: `analysisNarrative` is reset to null when `resetAnalysisState()` is called
   - Run: `npm test -- food-analyzer`
   - Verify: Tests fail

2. **GREEN** — Modify `food-analyzer.tsx`:
   - Add new state: `const [analysisNarrative, setAnalysisNarrative] = useState<string | null>(null)`
   - In the SSE handler for `text_delta` (line 216-218): keep accumulating into `textDeltaBufferRef.current`, but REMOVE the `setLoadingStep(textDeltaBufferRef.current)` call. The loading indicator should only show tool status messages.
   - In the SSE handler for `analysis` (line 222-224): after `setAnalysis(event.analysis)`, add `setAnalysisNarrative(textDeltaBufferRef.current.trim() || null)` to preserve the narrative
   - In `resetAnalysisState()` (line 84-105): add `setAnalysisNarrative(null)`
   - Pass `narrative={analysisNarrative}` to `<AnalysisResult>` at line 646-652
   - Run: `npm test -- food-analyzer`
   - Verify: Tests pass

**Notes:**
- The `loadingStep` fallback text "Analyzing your food..." in `analysis-result.tsx:40` will now be the default during text_delta streaming, which is a better UX than showing raw broken markdown.
- `textDeltaBufferRef` already exists at line 67 — no new ref needed.

### Task 7: Display collapsible narrative section in analysis result (FOO-648 — Part 2: analysis-result.tsx)

**Issue:** FOO-648
**Files:**
- `src/components/analysis-result.tsx` (modify)
- `src/components/__tests__/analysis-result.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests in `analysis-result.test.tsx`:
   - Test: When `narrative` prop is provided with meaningful content (>20 chars), a collapsible section titled "AI Analysis" is rendered
   - Test: The collapsible section is collapsed by default (narrative text not visible)
   - Test: Clicking the trigger expands the section and shows the narrative rendered via `ChatMarkdown`
   - Test: When `narrative` is null, no "AI Analysis" section is rendered
   - Test: When `narrative` is a short string (<20 chars), no "AI Analysis" section is rendered
   - Run: `npm test -- analysis-result`
   - Verify: Tests fail

2. **GREEN** — Modify `analysis-result.tsx`:
   - Add `narrative?: string | null` to `AnalysisResultProps`
   - Import `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger` from `@/components/ui/collapsible`
   - Import `ChatMarkdown` from `@/components/chat-markdown`
   - Import `ChevronDown` from `lucide-react` for the expand indicator
   - After the notes section (line 128), add the collapsible narrative section:
     - Only render if `narrative && narrative.length >= 20`
     - Use `<Collapsible>` with `defaultOpen={false}`
     - Trigger button: "AI Analysis" text + chevron icon that rotates on open
     - Content: `<ChatMarkdown content={narrative} />`
   - Add local state `const [narrativeOpen, setNarrativeOpen] = useState(false)` for controlling the chevron rotation
   - Run: `npm test -- analysis-result`
   - Verify: Tests pass

**Notes:**
- shadcn `Collapsible` is already in the project (imported in other components). Use the standard pattern.
- `ChatMarkdown` at `src/components/chat-markdown.tsx` handles tables, lists, bold/italic — exactly what the narrative needs.
- The 20-char threshold filters out trivially short narratives (e.g., just "Analyzing..." fragments).

### Task 8: Integration & Verification

**Issue:** FOO-604, FOO-605, FOO-609, FOO-610, FOO-645, FOO-648
**Files:** Various from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Open chat, verify screen reader announces new messages (FOO-604)
   - [ ] Verify chat input has accessible name in browser dev tools (FOO-605)
   - [ ] Navigate to History on a past date with no entries — verify icon + CTA buttons (FOO-609)
   - [ ] Navigate to a food detail page with a bad ID — verify error card with retry + back (FOO-610)
   - [ ] Analyze food and verify narrative appears in collapsible section after analysis (FOO-648)
   - [ ] Verify tool status messages still show during loading (FOO-648)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| SWR fetch error in food-detail | Show error card with retry button | Unit test (Task 4) |
| SWR mutate retry in food-detail | Re-fetches the data | Unit test (Task 4) |
| Empty history (no entries) | Show icon + CTA buttons | Unit test (Task 3) |
| Narrative is null/empty | No "AI Analysis" section shown | Unit test (Task 7) |
| Narrative is trivially short | No "AI Analysis" section shown | Unit test (Task 7) |

## Risks & Open Questions

- [ ] FOO-645 is a prompt engineering change — behavior depends on Claude model responses and cannot be deterministically tested. Unit tests verify prompt content, but effectiveness requires manual testing with real food logging flows.
- [ ] FOO-648 narrative length threshold (20 chars) may need tuning based on real usage — some short narratives may be useful. Start conservative and adjust.
- [ ] FOO-604 `aria-live="polite"` on a streaming chat may be noisy if the screen reader announces every text delta chunk. The `role="log"` semantics help (logs are polite by default), but real screen reader testing is needed to verify the experience is good.

## Scope Boundaries

**In Scope:**
- Chat accessibility: aria-label on input, aria-live on messages container
- History empty state: icon + CTA buttons
- Food detail error state: icon + retry + card structure
- Claude prompt: anti-confirmation rules in both system prompts
- Analysis narrative: accumulate, preserve, display in collapsible section

**Out of Scope:**
- FOO-634 (aria-live assertive → polite on analysis-result loading) — separate issue, different priority
- FOO-616 (dynamic state changes missing aria-live) — broader scope, separate plan
- FOO-618 (daily-dashboard hardcoded button styles) — not blocked by this plan
- Full screen reader E2E testing — requires manual verification beyond automated tests
