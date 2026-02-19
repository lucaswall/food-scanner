# Fix Plan: Images lost across conversation turns in chat

**Issue:** FOO-675
**Date:** 2026-02-19
**Status:** Planning
**Branch:** fix/FOO-675-chat-images-lost-across-turns

## Investigation

### Bug Report
When a user sends a first image in a chat conversation, then in a subsequent message adds another image (e.g., "add another thing"), Claude only sees/analyzes the second image — the first image is lost. The user has to explicitly insist before Claude processes both items together.

### Classification
- **Type:** Frontend Bug + API Design Gap
- **Severity:** High
- **Affected Area:** Food chat image handling across conversation turns

### Root Cause Analysis
Two compounding issues — one client-side, one server-side:

**1. Client: Images are ephemeral, not embedded in messages**
`src/components/food-chat.tsx:289-300` — `handleSend` collects images into a temporary `allImagesToSend` array. After sending, `pendingImages` is cleared (line 242). On subsequent turns, only new images from that turn are sent. Images from earlier turns are never re-sent.

**2. Server: Images only attach to the last user message**
`src/lib/claude.ts:1241-1270` — `conversationalRefine` finds `lastUserIndex` and attaches ALL images (the `images[]` param) only to that message. Even if all images were somehow sent, they'd all land on the latest message, not their original turns.

**3. Type system has no image support on messages**
`src/types/index.ts:399-404` — `ConversationMessage` only has `content: string`, no image field. `ChatFoodRequest` carries images as a separate top-level `images?: string[]` array with no per-message association.

**4. System prompt is aspirational**
`src/lib/claude.ts:53` — "When new photos are provided, they add to the existing meal" — Claude can't do this because it literally can't see previous images.

#### Evidence
- **File:** `src/components/food-chat.tsx:242` — `setPendingImages([])` clears images after each send
- **File:** `src/components/food-chat.tsx:289-296` — Only current turn images collected
- **File:** `src/lib/claude.ts:1241-1248` — `lastUserIndex` scan attaches images to wrong message
- **File:** `src/lib/claude.ts:1255-1270` — Images only on last user message
- **File:** `src/types/index.ts:399-410` — No image field on `ConversationMessage`; separate `images[]` on request
- **File:** `src/app/api/chat-food/route.ts:86-115` — Route extracts `images[]` as flat array, no per-message mapping

#### Related Code
- `src/components/food-chat.tsx:228-313` — `handleSend` function (image collection + API call)
- `src/lib/claude.ts:1224-1300` — `conversationalRefine` function (message→Anthropic format conversion)
- `src/app/api/chat-food/route.ts:85-114` — Image parsing and validation
- `src/app/api/chat-food/__tests__/route.test.ts:503-531` — Existing image passing test (only tests single-turn)

### Impact
- Claude loses visual context from earlier turns, producing wrong or incomplete food analysis
- Users must repeatedly ask Claude to "look at the other image" — broken UX
- Affects all multi-image chat sessions (photo-based food analysis is the primary use case)

## Fix Plan (TDD Approach)

### Step 1: Add `images` field to `ConversationMessage` type
**File:** `src/types/index.ts` (modify)

**Behavior:**
- Add optional `images?: string[]` field (base64 strings) to `ConversationMessage`
- Keep the top-level `images?: string[]` on `ChatFoodRequest` for backward compat during transition (remove in Step 5)
- This is purely a type change — no runtime behavior yet

### Step 2: Embed images into messages on the client
**File:** `src/components/food-chat.tsx` (modify)
**Test:** Not unit-testable (React component with DOM/Blob APIs) — covered by E2E

**Behavior:**
- When `handleSend` collects images (initial compressed images on first send, user-added `pendingImages` on any send), store them as base64 strings directly on the `ConversationMessage` object for that turn: `{ role: "user", content: "...", images: [...] }`
- The `blobsToBase64` conversion already exists (line 212-226) — call it before creating the message object
- Remove the separate `requestBody.images` field. Instead, the images travel inside `requestBody.messages[N].images`
- Remove `initialImagesSent` state — no longer needed since images are embedded in the message that originally carried them. On every send, ALL messages (with their embedded images) are sent to the server as part of the conversation history.
- Remove the `pendingImages`→`allImagesToSend`→`requestBody.images` flow (lines 289-300). Replace with: convert pending images to base64, attach to the new user message, add to messages state.
- Keep `pendingImages` state for the UI indicator (showing thumbnails before send) — just attach them to the message on send instead of sending separately.

### Step 3: Update API route to extract per-message images
**File:** `src/app/api/chat-food/route.ts` (modify)
**Test:** `src/app/api/chat-food/__tests__/route.test.ts` (modify)

**Behavior:**
- Accept images embedded in `messages[].images` (new format)
- Validate per-message images: each `messages[i].images` entry must be valid base64, within size limit
- Enforce total image count across all messages (sum of all `messages[i].images.length` <= MAX_IMAGES)
- Convert each message's `images` from base64 strings to `ImageInput[]` format and pass through to `conversationalRefine`
- Change `conversationalRefine` call signature: instead of a separate `images` param, pass messages that carry their own images (see Step 4)

**Tests:**
1. Accepts messages with per-message images and passes them to `conversationalRefine` correctly
2. Validates per-message image base64 format
3. Validates per-message image size limits
4. Enforces total image count across all messages
5. Rejects messages where `images` field is not an array of strings
6. Works with messages that have no images (backward compat: text-only conversations)

### Step 4: Update `conversationalRefine` to attach images per-message
**File:** `src/lib/claude.ts` (modify)
**Test:** `src/lib/__tests__/claude.test.ts` (modify)

**Behavior:**
- Change the `ConversationMessage` → `Anthropic.MessageParam` mapping (lines 1251-1299): instead of finding `lastUserIndex` and attaching all images there, attach each message's own `images[]` to that message's content blocks
- Remove the `lastUserIndex` scan (lines 1241-1248) and the conditional at line 1255
- For each user message that has `images`, prepend image content blocks before the text content block (images-before-text is the Anthropic best practice per their docs)
- Remove the top-level `images: ImageInput[]` parameter from `conversationalRefine` — images now come from the messages themselves
- Update the function signature and all callers (`chat-food/route.ts`)

**Tests:**
1. User message with images produces correct Anthropic content blocks (image blocks before text block)
2. Multiple user messages each with their own images — each message gets its own image blocks
3. User messages without images produce text-only content blocks
4. Mixed conversation: some messages with images, some without — correct attachment per message
5. Assistant messages are unaffected (no image blocks)

### Step 5: Clean up deprecated code paths
**File:** `src/types/index.ts` (modify)
**File:** `src/components/food-chat.tsx` (modify)
**File:** `src/app/api/chat-food/route.ts` (modify)

**Behavior:**
- Remove top-level `images?: string[]` from `ChatFoodRequest` type
- Remove `initialImagesSent` state variable and related logic from `food-chat.tsx`
- Remove the old image validation block in `route.ts` that handled the top-level `images` array (replaced by per-message validation in Step 3)
- Update the system prompt in `claude.ts:53` — the instruction "When new photos are provided, they add to the existing meal" now actually works correctly since Claude can see all images in their original positions. Keep the instruction but it's now truthful.

### Step 6: Verify
- [ ] All new tests pass
- [ ] All existing tests pass (update tests broken by signature changes)
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Manual test: multi-image chat flow works correctly (both images visible to Claude)

## Notes
- **No DB changes required** — images remain ephemeral (client-side only, sent per-request)
- **No migration needed** — this is a client+API change only
- **Token impact:** Minimal. Images are ~1,000-1,400 tokens each. Re-sending via conversation history benefits from Anthropic prompt caching (0.1x cost for cached turns). Net cost increase is negligible.
- **Payload size:** Typical food chat has 1-3 images at ~150KB each compressed. Even with 9 images across all turns, payload stays well under the 32MB API limit.
- **Anthropic best practice:** Their docs explicitly show multi-turn examples where each message keeps its own images. The "Four images across two conversation turns" example uses exactly this pattern.
- Steps 2-5 can be partially parallelized: Steps 3+4 (server changes) are independent of Step 2 (client changes) until final integration.

---

## Iteration 1

**Implemented:** 2026-02-19
**Method:** Single-agent (server changes tightly coupled via function signature; client has no unit tests)

### Tasks Completed This Iteration
- Step 1: Add `images` field to `ConversationMessage` type — added `images?: string[]`
- Step 4: Update `conversationalRefine` to per-message images — removed `images: ImageInput[]` param, reads images from `msg.images`, removed `lastUserIndex` scan
- Step 3: Update API route for per-message image validation — validates `messages[i].images`, enforces total count across messages, rejects images on assistant messages, rejects empty strings
- Step 2: Embed images into messages on client — `handleSend` converts blobs to base64 and embeds in user message, removed `initialImagesSent` state (replaced with ref), images persist in conversation history across turns
- Step 5: Clean up deprecated code — removed top-level `images` from `ChatFoodRequest`, removed old top-level image validation block in route, removed old image collection flow in client

### Files Modified
- `src/types/index.ts` — Added `images?: string[]` to `ConversationMessage`, removed top-level `images` from `ChatFoodRequest`
- `src/lib/claude.ts` — Refactored `conversationalRefine` signature and per-message image attachment
- `src/lib/__tests__/claude.test.ts` — 5 new per-message image tests, updated all existing call sites
- `src/app/api/chat-food/route.ts` — Per-message image validation, role check, empty string check
- `src/app/api/chat-food/__tests__/route.test.ts` — 4 new validation tests, updated existing image/call-site tests
- `src/components/food-chat.tsx` — Embed images in messages, use ref for initial image tracking, fixed ref leak bug
- `src/components/__tests__/food-chat.test.tsx` — Updated 4 image tests to check per-message format

### Linear Updates
- FOO-675: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH + 2 MEDIUM bugs, all fixed before proceeding
- verifier: All 2068 tests pass, zero warnings
