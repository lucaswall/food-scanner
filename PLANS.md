# Implementation Plan

**Created:** 2026-02-15
**Source:** Inline request: Unify FoodChat and FreeChat into a single component with shared API endpoint
**Linear Issues:** [FOO-518](https://linear.app/lw-claude/issue/FOO-518/merge-api-routes-consolidate-apichat-into-apichat-food), [FOO-519](https://linear.app/lw-claude/issue/FOO-519/unify-foodchat-component-optional-initial-analysis-dynamic-header), [FOO-520](https://linear.app/lw-claude/issue/FOO-520/wire-up-appchat-page-to-unified-foodchat-and-delete-freechat), [FOO-521](https://linear.app/lw-claude/issue/FOO-521/e2e-test-for-unified-free-form-chat-flow)

## Context Gathered

### Codebase Analysis

**Two chat stacks exist with ~70% code duplication:**

| Layer | FoodChat | FreeChat |
|---|---|---|
| Component | `src/components/food-chat.tsx` (637 lines) | `src/components/free-chat.tsx` (258 lines) |
| Page | Inline in `src/components/food-analyzer.tsx` | `src/app/app/chat/page.tsx` |
| API route | `src/app/api/chat-food/route.ts` (163 lines) | `src/app/api/chat/route.ts` (118 lines) |
| Claude fn | `conversationalRefine()` | `freeChat()` |
| System prompt | `CHAT_SYSTEM_PROMPT` (food analysis + refinement) | `FREE_CHAT_SYSTEM_PROMPT` (nutrition advisor) |
| Tools | `report_nutrition` + data tools | Data tools only |
| Auth | `requireFitbit: true` | `requireFitbit: false` |

**Duplicated patterns (verbatim):**
- Message list rendering (bubble styling, alignment)
- Scroll-to-bottom button logic
- Auto-scroll on new messages
- Error display with dismiss button
- Loading spinner bubble
- Conversation limit warnings (near/at limit)
- Bottom input bar (Input + Send + Enter key)
- Error recovery on failed sends (rollback message, restore input)
- Timeout/abort error handling

**Key differences (FoodChat has, FreeChat lacks):**
- Image handling (camera/gallery, compression, pending indicators)
- MiniNutritionCard with diff highlighting
- "Log to Fitbit" button + MealTypeSelector in header
- `initialAnalysis` prop and `latestAnalysis` state
- `onLogged` callback and logging flow

**Navigation:**
- Dashboard (`/app`) → Link to `/app/chat` (FreeChat)
- Dashboard → `/app/analyze` → "Refine with chat" button → FoodChat inline overlay
- FreeChat: back navigates to `/app`
- FoodChat: back calls `onClose()` → returns to food-analyzer

**Backend:**
- `conversationalRefine()` already handles missing `initialAnalysis` gracefully — it simply omits the analysis context from the system prompt
- `conversationalRefine()` includes `report_nutrition` + data tools; `freeChat()` only has data tools
- `conversationalRefine()` does one API call then delegates to `runToolLoop()` if data tools used; `freeChat()` goes straight to `runToolLoop()`
- Both share `runToolLoop()` which already returns `{ message, analysis? }`

**Tests:**
- `food-chat.test.tsx` (977 lines) — comprehensive: send/receive, images, logging, error handling, message limits, compression
- `free-chat.test.tsx` (257 lines) — basic: send/receive, error handling, message limits, navigation
- `route.test.ts` for `/api/chat-food` (442 lines) — validation, auth with Fitbit requirement, API calls
- `route.test.ts` for `/api/chat` (327 lines) — validation, auth without Fitbit requirement, API calls
- `refine-chat.spec.ts` E2E (199 lines) — screenshot captures, chat flow, logging from chat, error handling

**Types (src/types/index.ts):**
- `ChatFoodRequest` — has `messages`, `images?`, `initialAnalysis?`
- `ChatFoodResponse` — has `message`, `analysis?`
- `ChatRequest` — has `messages` only
- `ChatResponse` — has `message` only

### Design Decision: Unified UX

The unified FoodChat starts in two modes based on props:
1. **With initial analysis** (from food-analyzer): Shows nutrition card + "Log to Fitbit" + MealTypeSelector immediately. Same as current FoodChat.
2. **Without initial analysis** (from dashboard /app/chat): Shows simple header (Back + title). User chats freely. When Claude calls `report_nutrition`, the header "grows" to show MealTypeSelector + "Log to Fitbit". Nutrition cards appear inline. From that point, behaves exactly like post-analysis refinement.

The API endpoint drops `requireFitbit: true` — Fitbit is only needed at log time (separate `/api/log-food` endpoint validates this).

## Original Plan

### Task 1: Merge API routes — consolidate /api/chat into /api/chat-food
**Linear Issue:** [FOO-518](https://linear.app/lw-claude/issue/FOO-518/merge-api-routes-consolidate-apichat-into-apichat-food)

**Files:**
- `src/app/api/chat-food/route.ts` (modify)
- `src/app/api/chat-food/__tests__/route.test.ts` (modify)
- `src/app/api/chat/route.ts` (delete)
- `src/app/api/chat/__tests__/route.test.ts` (delete)
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/types/index.ts` (modify)

**Behavioral spec:**
1. `/api/chat-food` drops `requireFitbit: true` → uses `requireFitbit: false` (Fitbit validation happens at `/api/log-food`, not at chat time)
2. `initialAnalysis` and `images` remain optional — when absent, the route works like the current `/api/chat` (free-form conversation)
3. `conversationalRefine()` becomes the single backend function. When `initialAnalysis` is undefined and no images provided, it uses a merged system prompt that can both advise on nutrition AND identify/analyze food from text descriptions
4. `freeChat()` is deleted from `src/lib/claude.ts`
5. `FREE_CHAT_SYSTEM_PROMPT` merges into `CHAT_SYSTEM_PROMPT` — the prompt should instruct Claude to: (a) answer nutrition questions using data tools, (b) when the user describes or shows food, analyze it and call `report_nutrition`, (c) when refining existing analysis, confirm changes with updated values
6. Message limit unifies to 20 (same for both modes — the backend enforces this, component mirrors it)
7. Delete `ChatRequest`, `ChatResponse` types from `src/types/index.ts` — only `ChatFoodRequest` and `ChatFoodResponse` remain
8. Delete `/api/chat/route.ts` and its test file entirely

**TDD steps:**
1. Write tests in `/api/chat-food/__tests__/route.test.ts` for the new behavior:
   - Test that route works without `initialAnalysis` and without `images` (free-form mode)
   - Test that route does NOT require Fitbit connection (change existing test expectations)
   - Test that `conversationalRefine()` is called (not `freeChat()`) in all cases
2. Run verifier with pattern `chat-food` (expect fail — route still requires Fitbit)
3. Modify `/api/chat-food/route.ts`: change `requireFitbit: true` to `requireFitbit: false`
4. Modify `src/lib/claude.ts`: merge `FREE_CHAT_SYSTEM_PROMPT` capabilities into `CHAT_SYSTEM_PROMPT`, delete `freeChat()` function and `FREE_CHAT_SYSTEM_PROMPT`
5. Update `src/lib/__tests__/claude.test.ts`: remove `freeChat()` tests, add test for `conversationalRefine()` without `initialAnalysis`
6. Delete `src/types/index.ts` ChatRequest/ChatResponse interfaces
7. Delete `src/app/api/chat/route.ts` and `src/app/api/chat/__tests__/route.test.ts`
8. Run verifier with pattern `claude|chat-food` (expect pass)

### Task 2: Unify FoodChat component — make initial analysis optional, add dynamic header
**Linear Issue:** [FOO-519](https://linear.app/lw-claude/issue/FOO-519/unify-foodchat-component-optional-initial-analysis-dynamic-header)

**Files:**
- `src/components/food-chat.tsx` (modify — major refactor)
- `src/components/__tests__/food-chat.test.tsx` (modify — add free-form mode tests)

**Behavioral spec:**
1. `FoodChatProps` changes:
   - `initialAnalysis` becomes optional (`FoodAnalysis | undefined`)
   - `compressedImages` becomes optional (default `[]`)
   - `initialMealTypeId` becomes optional (default from `getDefaultMealType()`)
   - `onClose` remains required — caller decides where "Back" navigates
   - `onLogged` remains required but only called when logging happens
   - New optional prop: `title?: string` — shown in header when no analysis present (default "Chat")
2. Initial message changes based on mode:
   - With `initialAnalysis`: Current behavior — "I analyzed your food as X (Y cal)..."
   - Without `initialAnalysis`: Greeting — "Hi! Ask me anything about your nutrition, or describe a meal to log it."
3. Header behavior:
   - Always shows: Back button (left side)
   - With analysis (either initial or acquired mid-chat): Shows "Log to Fitbit" button + MealTypeSelector row
   - Without analysis: Shows title text (e.g., "Chat")
   - Transition: When first `analysis` appears in messages mid-conversation, header grows to include MealTypeSelector and "Log to Fitbit" — no page reload, smooth state change
4. `latestAnalysis` derives from messages as before. When it's `undefined` (no analysis yet), the "Log to Fitbit" button and MealTypeSelector are hidden
5. All API calls go to `/api/chat-food` (FreeChat's `/api/chat` is deleted in Task 1)
6. Message limit: 20 for both modes (constant `MAX_MESSAGES = 20`)
7. Image handling available in both modes — user can always attach photos via the `+` button
8. `ConversationMessage` type already has optional `analysis` — no type changes needed

**TDD steps:**
1. Write tests for free-form mode in `food-chat.test.tsx`:
   - Test rendering without `initialAnalysis` shows greeting message, not analysis message
   - Test header shows title "Chat" when no analysis present (no "Log to Fitbit", no MealTypeSelector)
   - Test that when API returns a response with `analysis`, the header updates to show "Log to Fitbit" + MealTypeSelector
   - Test that MiniNutritionCard appears when first analysis arrives mid-conversation
   - Test that image attachment works in free-form mode
   - Test API calls go to `/api/chat-food` (not `/api/chat`)
2. Run verifier with pattern `food-chat` (expect fail)
3. Refactor `FoodChat` component:
   - Make props optional with defaults
   - Conditional initial message based on `initialAnalysis` presence
   - Conditional header rendering based on `latestAnalysis` existence
   - Change fetch URL to always use `/api/chat-food`
4. Run verifier with pattern `food-chat` (expect pass)
5. Update existing tests that break due to prop changes (add defaults where needed)

### Task 3: Wire up /app/chat page and food-analyzer to use unified FoodChat
**Linear Issue:** [FOO-520](https://linear.app/lw-claude/issue/FOO-520/wire-up-appchat-page-to-unified-foodchat-and-delete-freechat)

**Files:**
- `src/app/app/chat/page.tsx` (modify)
- `src/app/app/chat/loading.tsx` (modify)
- `src/app/app/__tests__/page.test.tsx` (modify if needed)
- `src/components/food-analyzer.tsx` (verify — should need minimal changes)
- `src/components/__tests__/food-analyzer.test.tsx` (modify if FoodChat import changes)
- `src/components/free-chat.tsx` (delete)
- `src/components/__tests__/free-chat.test.tsx` (delete)

**Behavioral spec:**
1. `/app/chat/page.tsx`: Replace `<FreeChat />` with `<FoodChat>` in free-form mode:
   - No `initialAnalysis`, no `compressedImages`, no `initialMealTypeId`
   - `onClose` navigates to `/app` (using `useRouter().push`)
   - `onLogged` navigates to a success state — but since this page is a server component wrapping a client component, the page needs to become a client component or wrap FoodChat in a client wrapper that handles the logged state (show FoodLogConfirmation)
   - Consider: the simplest approach is a small client wrapper component that manages the `logResponse` state and renders either FoodChat or FoodLogConfirmation
2. `loading.tsx`: Update skeleton to include the `+` photo button placeholder (matching FoodChat's input area)
3. `food-analyzer.tsx`: Should need zero or minimal changes — it already passes all required props to FoodChat. Verify the optional prop defaults don't break anything.
4. Delete `free-chat.tsx` and its test file
5. Dashboard link (`/app` page) continues pointing to `/app/chat` — no change needed

**TDD steps:**
1. Write test for the new `/app/chat` page wrapper behavior:
   - Test that FoodChat renders in free-form mode (no analysis, no images)
   - Test that back navigation goes to `/app`
   - Test that logging success shows confirmation
2. Run verifier (expect fail — FreeChat still exists)
3. Create client wrapper component (inline in page.tsx or as a separate small component) that:
   - Manages `logResponse` state
   - Renders FoodChat with `onClose={() => router.push("/app")}` and `onLogged` handler
   - Shows FoodLogConfirmation when logged
4. Delete `free-chat.tsx` and `free-chat.test.tsx`
5. Update `loading.tsx` skeleton
6. Run verifier with pattern `chat|food-analyzer|page` (expect pass)

### Task 4: Update E2E test and cleanup
**Linear Issue:** [FOO-521](https://linear.app/lw-claude/issue/FOO-521/e2e-test-for-unified-free-form-chat-flow)

**Files:**
- `e2e/tests/refine-chat.spec.ts` (modify — add free-form chat test)
- `src/app/app/chat/page.tsx` (verify)

**Behavioral spec:**
1. Add E2E test for free-form chat flow:
   - Navigate to `/app/chat`
   - Verify greeting message shown
   - Verify header shows "Chat" title (no "Log to Fitbit")
   - Send a message, verify response
   - When response includes analysis, verify header updates with "Log to Fitbit" button
2. Existing refine-chat E2E tests should still pass — they test the food-analyzer → FoodChat flow which hasn't changed structurally
3. Update any E2E mocks that hit `/api/chat` to use `/api/chat-food` if needed

**TDD steps:**
1. Run existing E2E tests to verify they still pass after Tasks 1-3
2. Add new test case for free-form chat in `refine-chat.spec.ts` (or create a new `free-chat.spec.ts` — but since the component is now unified, adding to `refine-chat.spec.ts` is cleaner, or rename it to `chat.spec.ts`)
3. Run E2E with `npm run e2e`

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Unify FoodChat and FreeChat into a single FoodChat component with one shared API endpoint

**Request:** Merge the two chat experiences — FoodChat (post-analysis refinement) and FreeChat (open-ended nutrition Q&A) — into one component. Both use the same API, same message limit, same capabilities. The only difference is whether initial analysis context is provided. A free-form chat can evolve into a food logging session when Claude identifies food.

**Linear Issues:** FOO-518, FOO-519, FOO-520, FOO-521

**Approach:** Bottom-up: first merge the backend (one API route, one Claude function, one system prompt), then refactor the FoodChat component to handle optional initial analysis with a dynamic header that shows logging controls only when analysis data exists, then rewire the /app/chat page to use the unified component, and finally delete all FreeChat artifacts.

**Scope:**
- Tasks: 4
- Files affected: ~15 (modify ~8, delete ~6, verify ~2)
- New tests: yes (free-form mode unit tests, E2E test)

**Key Decisions:**
- Drop `requireFitbit` on the chat endpoint — Fitbit is validated at log time only
- Message limit unifies to 20 for both modes
- System prompt merges: Claude can both advise on nutrition AND analyze/identify food
- Header is dynamic: grows to show logging controls when analysis appears mid-conversation

**Risks/Considerations:**
- System prompt merge needs careful wording so Claude knows when to call `report_nutrition` (user describes food) vs. when to just answer questions (user asks about history)
- The `/app/chat` page transitions from server component + FreeChat to needing client state management for the logged/confirmation flow
- E2E tests mock `/api/chat-food` — existing tests should keep working since we're keeping that endpoint
