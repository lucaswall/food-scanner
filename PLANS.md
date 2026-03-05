# Implementation Plan

**Created:** 2026-03-05
**Source:** Inline request: Analysis session persistence — persist analysis state (including photos) so accidental navigation doesn't lose work, fix Fitbit token expiry photo loss
**Linear Issues:** [FOO-814](https://linear.app/lw-claude/issue/FOO-814/add-idb-dependency-and-create-analysis-session-storage-module), [FOO-815](https://linear.app/lw-claude/issue/FOO-815/create-useanalysissession-hook), [FOO-816](https://linear.app/lw-claude/issue/FOO-816/integrate-useanalysissession-hook-into-foodanalyzer), [FOO-817](https://linear.app/lw-claude/issue/FOO-817/add-clear-triggers-and-start-fresh-ui-for-analysis-session), [FOO-818](https://linear.app/lw-claude/issue/FOO-818/fix-pending-submission-to-use-indexeddb-photos-on-fitbit-token-expiry)
**Branch:** feat/analysis-session-persistence

## Context Gathered

### Codebase Analysis

- **Related files:**
  - `src/components/food-analyzer.tsx` (748 lines) — Main analysis component with 18 `useState` hooks. Persistent state: `photos` (File[]), `convertedPhotoBlobs` ((File|Blob)[]), `compressedImages` (Blob[]), `description` (string), `analysis` (FoodAnalysis|null), `analysisNarrative` (string|null), `mealTypeId` (number), `selectedTime` (string|null), `matches` (FoodMatch[]). Transient state: `compressing`, `loading`, `loadingStep`, `error`, `logging`, `logError`, `logResponse`, `resubmitting`, `resubmitFoodName`, `streamingText`, `chatOpen`, `seedMessages`.
  - `src/lib/pending-submission.ts` (60 lines) — Current persistence: saves `FoodAnalysis`, `mealTypeId`, `foodName`, `date`, `time` to `sessionStorage` on Fitbit token expiry. Does NOT save photos — retry after OAuth produces poor results.
  - `src/components/pending-submission-handler.tsx` (145 lines) — Auto-resubmit component mounted in app layout. Checks `getPendingSubmission()` on mount.
  - `src/lib/image.ts` (126 lines) — Photo compression pipeline: `validateImage()`, `isHeicFile()`, `convertHeicToJpeg()`, `compressImage()` (max 1024px, JPEG 0.8 quality → Blob).
  - `src/types/index.ts` — `FoodAnalysis` (lines 55-82), `FoodMatch` (lines 239-255), `ConversationMessage` (lines 417-423).
  - `src/hooks/use-debounce.ts` — Simple hook pattern: `useState` + `useEffect` with cleanup.
  - `src/app/app/layout.tsx` (35 lines) — Server Component, wraps all `/app/*` pages. Renders `PendingSubmissionHandler`.
  - `src/app/app/analyze/page.tsx` (33 lines) — Server Component mounting `FoodAnalyzer`.
- **Existing patterns:**
  - `sessionStorage` used for pending submission (key: `"food-scanner-pending-submission"`), `localStorage` for theme and refresh guard.
  - No IndexedDB usage in codebase. `idb` is NOT a dependency.
  - Runtime validation: `isValidPendingSubmission()` checks shape before trusting stored data.
  - Custom hooks in `src/hooks/`, tests in `src/hooks/__tests__/`.
  - Vitest with jsdom environment. `vi.mock()` for modules, `vi.stubGlobal()` for browser APIs.
- **Test conventions:**
  - `src/lib/__tests__/pending-submission.test.ts` (258 lines) — validates serialization, malformed JSON, missing fields, wrong types.
  - `src/components/__tests__/food-analyzer.test.tsx` — mocked child components, assertion on callback calls.
  - `src/lib/__tests__/image.test.ts` — tests compression, HEIC detection, validation.

### MCP Context

- **MCPs used:** Linear (issue check)
- **Findings:** All related issues (FOO-168 token expiry, FOO-265 useReducer, FOO-414 stale analysis, FOO-272/387 unmount state updates) are Released or Canceled. No in-progress work conflicts. Todo queue is clear.

## Tasks

### Task 1: Add `idb` dependency and create analysis session storage module
**Linear Issue:** [FOO-814](https://linear.app/lw-claude/issue/FOO-814/add-idb-dependency-and-create-analysis-session-storage-module)
**Files:**
- `package.json` (modify)
- `src/lib/analysis-session.ts` (create)
- `src/lib/__tests__/analysis-session.test.ts` (create)

**Steps:**
1. Install `idb` package: `npm install idb`
2. Write tests in `src/lib/__tests__/analysis-session.test.ts` for the storage layer:
   - **IndexedDB photo operations:**
     - `saveSessionPhotos(sessionId, blobs)` stores Blob array, `loadSessionPhotos(sessionId)` returns them
     - `saveSessionPhotos` with empty array stores empty array
     - `loadSessionPhotos` with nonexistent session returns empty array
   - **sessionStorage state operations:**
     - `saveSessionState(sessionId, state)` stores serializable state, `loadSessionState(sessionId)` returns it
     - State includes: `description`, `analysis`, `analysisNarrative`, `mealTypeId`, `selectedTime`, `matches`, `createdAt` (ISO timestamp)
     - `loadSessionState` with nonexistent session returns `null`
     - `loadSessionState` with malformed JSON returns `null` (no throw)
     - `loadSessionState` with invalid shape returns `null` — runtime validation like `pending-submission.ts`
   - **Session lifecycle:**
     - `clearSession(sessionId)` removes from both IndexedDB and sessionStorage
     - `getActiveSessionId()` returns current session ID from sessionStorage, or `null`
     - `createSessionId()` generates a new UUID and stores it in sessionStorage
   - **TTL expiry:**
     - `isSessionExpired(state)` returns `true` if `createdAt` is older than 24 hours
     - `cleanupExpiredSession()` checks active session and clears it if expired
   - **IndexedDB unavailable fallback:**
     - When IndexedDB is unavailable (mock `indexedDB` as undefined), photo save/load silently returns empty — no throws
3. Run `npx vitest run "analysis-session"` — expect fail
4. Implement `src/lib/analysis-session.ts`:
   - Use `idb` library's `openDB()` for IndexedDB. Database name: `"food-scanner"`, store: `"session-photos"`, keyed by session ID.
   - sessionStorage key pattern: `"food-scanner-analysis-session"` for state, `"food-scanner-session-id"` for active session ID.
   - Runtime validation function `isValidSessionState()` following `isValidPendingSubmission()` pattern in `src/lib/pending-submission.ts`.
   - All IndexedDB operations wrapped in try/catch — return safe defaults on failure (empty array for photos, null for state).
5. Run `npx vitest run "analysis-session"` — expect pass

**Notes:**
- The `idb` library (~3KB) provides typed async API over raw IndexedDB. Follow pattern at `src/lib/pending-submission.ts` for the sessionStorage layer.
- Photos are stored as raw Blobs in IndexedDB (native binary support, no base64 encoding needed).
- `FoodMatch.lastLoggedAt` is a `Date` object — must serialize to ISO string on save and parse back on load. Handle this in the validation/deserialization layer.
- Separate `sessionStorage` keys from the existing `"food-scanner-pending-submission"` key to avoid conflicts.

### Task 2: Create `useAnalysisSession` hook
**Linear Issue:** [FOO-815](https://linear.app/lw-claude/issue/FOO-815/create-useanalysissession-hook)
**Files:**
- `src/hooks/use-analysis-session.ts` (create)
- `src/hooks/__tests__/use-analysis-session.test.ts` (create)

**Steps:**
1. Write tests in `src/hooks/__tests__/use-analysis-session.test.ts`:
   - **Restore on mount:**
     - When active session exists with valid state and photos, hook returns restored values for all persisted fields
     - When active session exists but photos missing from IndexedDB, restores state without photos (graceful degradation)
     - When no active session exists, returns default empty state
     - When session is expired (>24h), clears it and returns default empty state
   - **Save on change:**
     - When persisted state changes (description, analysis, mealTypeId, etc.), debounce-writes to sessionStorage (~300ms)
     - When photos change, writes blobs to IndexedDB immediately (no debounce — photos are captured infrequently)
   - **Loading state:**
     - Returns `isRestoring: true` while IndexedDB async read is in progress
     - Returns `isRestoring: false` after restore completes (whether successful or empty)
   - **Session ID management:**
     - Creates new session ID on first photo capture (not on mount)
     - Reuses existing session ID if one exists
   - Mock `src/lib/analysis-session.ts` functions for unit testing.
2. Run `npx vitest run "use-analysis-session"` — expect fail
3. Implement `src/hooks/use-analysis-session.ts`:
   - Hook signature: `useAnalysisSession()` returns `{ state, actions, isRestoring }` where `state` contains all persisted fields and `actions` contains setters that both update React state and trigger persistence.
   - On mount: check for active session, load from storage, set `isRestoring` during async IndexedDB read.
   - State changes trigger persistence via `useEffect` with debounce (300ms for serializable state, immediate for photos).
   - Follow hook patterns in `src/hooks/use-debounce.ts` — `useState` + `useEffect` with cleanup.
4. Run `npx vitest run "use-analysis-session"` — expect pass

**Notes:**
- The hook abstracts all storage complexity. `FoodAnalyzer` will call hook actions instead of raw `useState` setters for persisted fields.
- `isRestoring` enables a brief loading state on the analyze page while IndexedDB reads complete (typically <50ms but async).
- Photos are written immediately because they're captured one at a time (not rapid-fire). Serializable state is debounced because description typing fires on every keystroke.

### Task 3: Integrate `useAnalysisSession` into FoodAnalyzer
**Linear Issue:** [FOO-816](https://linear.app/lw-claude/issue/FOO-816/integrate-useanalysissession-hook-into-foodanalyzer)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. Update tests in `src/components/__tests__/food-analyzer.test.tsx`:
   - Mock `src/hooks/use-analysis-session` — return default empty state with `isRestoring: false`
   - Test: when `isRestoring` is true, component shows a loading skeleton (not the empty analyze form)
   - Test: when hook returns restored state (photos, description, analysis, etc.), component renders with restored values
   - Test: when user captures photos, hook's `setPhotos` action is called
   - Test: when user types description, hook's `setDescription` action is called
   - Test: when analysis completes, hook's `setAnalysis` and `setNarrative` actions are called
2. Run `npx vitest run "food-analyzer"` — expect fail
3. In `src/components/food-analyzer.tsx`:
   - Import and call `useAnalysisSession()` at the top of the component
   - Replace `useState` calls for persisted fields (`photos`, `convertedPhotoBlobs`, `compressedImages`, `description`, `analysis`, `analysisNarrative`, `mealTypeId`, `selectedTime`, `matches`) with values and setters from the hook
   - Keep all transient state as raw `useState` (`compressing`, `loading`, `loadingStep`, `error`, `logging`, `logError`, `logResponse`, `resubmitting`, `resubmitFoodName`, `streamingText`, `chatOpen`, `seedMessages`)
   - When `isRestoring` is true, render a loading skeleton matching the analyze page's `loading.tsx` layout
   - Preserve all existing behavior — the hook is a drop-in replacement for the persisted `useState` calls
4. Run `npx vitest run "food-analyzer"` — expect pass

**Notes:**
- This is the largest task — threading the hook through all state references in a 748-line component. Careful not to break existing flows (SSE streaming, compression, photo capture, logging).
- The `handlePhotosChange` callback (line 77) resets analysis state when photos are cleared — this behavior must be preserved. The hook's setters should allow batch updates.
- `resetAnalysisState()` (line 89) clears multiple fields — must call the hook's actions for each persisted field.
- `autoCapture` search param flow (photo capture on mount) should work with the hook — if no restored session, proceed normally.

### Task 4: Add clear triggers and "Start Fresh" UI
**Linear Issue:** [FOO-817](https://linear.app/lw-claude/issue/FOO-817/add-clear-triggers-and-start-fresh-ui-for-analysis-session)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. Write tests in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test: after successful food log (logResponse received), session is cleared via hook's `clearSession` action
   - Test: when a restored session is showing (photos/analysis present from restore), a "Start fresh" link is visible
   - Test: when state is NOT restored (user just captured photos), "Start fresh" link is NOT visible
   - Test: clicking "Start fresh" clears the session and resets all persisted state to defaults
2. Run `npx vitest run "food-analyzer"` — expect fail
3. In `src/components/food-analyzer.tsx`:
   - After successful log (where `logResponse` is set), call the hook's `clearSession()` action
   - Add a `wasRestored` flag from the hook (true if the current state came from storage, false if user started fresh)
   - When `wasRestored` is true and the component has photos or analysis, render a small "Start fresh" text link near the top of the form (below the header, not prominent)
   - "Start fresh" calls hook's `clearSession()` and resets all persisted state to defaults
   - Touch target: at least 44px height per mobile-first policy
4. Run `npx vitest run "food-analyzer"` — expect pass

**Notes:**
- "Start fresh" is a subtle link, not a button — prevents accidental clears. The roadmap spec explicitly says "Small link, not prominent."
- Session is NOT cleared on navigation away — that's the whole point. Only cleared on successful log or explicit user action.
- The `wasRestored` flag distinguishes between "user just took photos" (no Start Fresh shown) and "state was loaded from storage" (Start Fresh shown).

### Task 5: Fix pending-submission to use IndexedDB photos on Fitbit token expiry
**Linear Issue:** [FOO-818](https://linear.app/lw-claude/issue/FOO-818/fix-pending-submission-to-use-indexeddb-photos-on-fitbit-token-expiry)
**Files:**
- `src/lib/pending-submission.ts` (modify)
- `src/lib/__tests__/pending-submission.test.ts` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/pending-submission-handler.tsx` (modify)
- `src/components/__tests__/pending-submission-handler.test.tsx` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/pending-submission.test.ts`:
   - Test: `PendingSubmission` interface now includes optional `sessionId: string` field
   - Test: `savePendingSubmission` stores `sessionId` when provided
   - Test: `isValidPendingSubmission` accepts objects with `sessionId` field
   - Test: `isValidPendingSubmission` still accepts objects without `sessionId` (backward compat)
2. Write tests in `src/components/__tests__/pending-submission-handler.test.tsx`:
   - Test: when pending submission has `sessionId`, photos are loaded from IndexedDB via `loadSessionPhotos(sessionId)` and included in resubmit
   - Test: when pending submission has no `sessionId`, resubmit proceeds without photos (existing behavior)
   - Test: after successful resubmit with `sessionId`, session is cleared from IndexedDB
3. Run `npx vitest run "pending-submission"` — expect fail
4. In `src/lib/pending-submission.ts`:
   - Add optional `sessionId?: string` to `PendingSubmission` interface
   - Update `isValidPendingSubmission` to accept the new field
5. In `src/components/food-analyzer.tsx`:
   - In the `handleLogToFitbit` error path where `savePendingSubmission()` is called (around line 375), include the active session ID from the hook: `savePendingSubmission({ ...data, sessionId: activeSessionId })`
   - Do NOT call `clearSession()` here — the session must survive the OAuth redirect
6. In `src/components/pending-submission-handler.tsx`:
   - When resubmitting with a `sessionId`, load photos from IndexedDB via `loadSessionPhotos(sessionId)` and include them in the resubmit request
   - After successful resubmit, clear the analysis session via `clearSession(sessionId)`
7. Run `npx vitest run "pending-submission"` — expect pass

**Notes:**
- This fixes the core "photos lost on Fitbit token expiry" problem. Today, `pending-submission` only stores `FoodAnalysis` JSON. With session persistence in place, photos are already in IndexedDB before the token error occurs. The pending submission just needs to reference the session ID.
- Backward compatible: old pending submissions without `sessionId` still work (resubmit without photos, same as today).
- The OAuth redirect navigates away from the analyze page, which would normally lose state. But with session persistence, the full state (including photos) survives in IndexedDB + sessionStorage.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Persist the full analysis session state (including photos) so accidental navigation doesn't lose work, and fix the Fitbit token expiry flow to retain photos during OAuth redirect.
**Linear Issues:** FOO-814, FOO-815, FOO-816, FOO-817, FOO-818
**Approach:** Dual storage layer — IndexedDB (via `idb` library) for photo blobs, sessionStorage for serializable state (description, analysis, narrative, meal type, time, matches). A `useAnalysisSession` hook abstracts persistence and provides drop-in replacements for FoodAnalyzer's persisted `useState` calls. Sessions auto-expire after 24 hours. The existing `pending-submission` flow is extended with a session ID reference so photos survive OAuth redirects.
**Scope:** 5 tasks, ~8 files, ~30 tests
**Key Decisions:**
- IndexedDB for photos (native blob support, no base64 overhead) + sessionStorage for serializable state (simple, fast, already used in codebase)
- `idb` library (~3KB) over raw IndexedDB API — cleaner async interface, well-maintained, types included
- One session at a time — new state overwrites previous, never stacks
- Seamless auto-restore on mount (no "resume session?" prompt)
- "Start Fresh" as subtle link, not button — prevents accidental clears
- Chat state explicitly NOT persisted — this feature is analyze-screen only
**Risks:**
- FoodAnalyzer is 748 lines with 18 useState hooks — Task 3 (integration) is the riskiest task, threading the hook through all state references without breaking existing flows
- jsdom may not fully support IndexedDB in tests — may need `fake-indexeddb` polyfill for Vitest
