# Implementation Plan

**Created:** 2026-04-08
**Source:** Inline request: Pull AI-Driven Staging QA from roadmap — create a standalone Claude Code skill that uses Chrome browser automation to run functional QA against the live staging site
**Linear Issues:** [FOO-898](https://linear.app/lw-claude/issue/FOO-898/create-staging-qa-skill-with-initial-4-scenarios), [FOO-899](https://linear.app/lw-claude/issue/FOO-899/register-staging-qa-skill-and-remove-from-roadmap)
**Branch:** feat/staging-qa

## Context Gathered

### Codebase Analysis

**Existing skill patterns:**
- 14 skills in `.claude/skills/`, all follow: YAML frontmatter → phases → rules → termination
- Skills with side effects use `disable-model-invocation: true` (e.g., `investigate`, `deep-review`, `push-to-production`)
- Large reference docs go in `references/` subdirectory (e.g., `plan-inline/references/plans-template.md`)
- Skills reference (`tools-improve/references/skills-reference.md`) says: keep SKILL.md under 500 lines, `disable-model-invocation: true` for side effects, no `context: fork` when Chrome MCP connection is needed
- "ultrathink" keyword enables extended thinking in skills

**Chrome MCP tools available (18 total, 13 needed):**
- `tabs_context_mcp` — tab group context (MUST call first each session)
- `tabs_create_mcp` — create new tab in MCP group
- `navigate` — URL navigation
- `computer` — mouse, keyboard, screenshots, scrolling, waiting (max 30s per wait)
- `read_page` — accessibility tree with element refs (max 50K chars, filterable)
- `find` — natural-language element search (returns refs)
- `form_input` — set form values by ref
- `get_page_text` — extract main text content
- `javascript_tool` — execute JS in page context
- `read_console_messages` — filtered console output
- `read_network_requests` — network activity with URL pattern filtering
- `gif_creator` — record browser sessions as GIFs (start_recording → stop_recording → export)
- `resize_window` — responsive testing

**E2E test patterns (reference for QA scenarios):**
- Analyze flow: textarea placeholder `"e.g., 250g pollo asado con chimichurri"`, button `"Analyze Food"`, heading with food_name after analysis, button `"Log to Fitbit"`, text `/logged successfully/i`, button `"Done"`
- Dashboard: navigation `"Main navigation"`, buttons `"Daily"`/`"Weekly"`, link `"Settings"`
- History: food entries with names, calorie counts, dates
- All pages use `waitForLoadState('networkidle')` pattern

**Production AI analysis timings (from Railway logs, Apr 7-8):**
- Simple text, no tool calls: ~9s
- Text + nutrition label lookups: ~35s (label search + report_nutrition loop)
- Images + label saves + lookups: ~23-30s
- Complex multi-tool: 30-35s+
- **CRITICAL:** The roadmap spec said "5-15 seconds" — real production times are 9-35s. The QA skill must use 60-90s total wait budgets with active DOM polling.

**Chrome extension reliability (from external research):**
- Chrome MV3 terminates idle service workers after ~30s, killing the WebSocket connection
- `javascript_tool` writes to localStorage can trigger immediate disconnection (issue #27597)
- Sessions >10-30 minutes frequently drop (issues #26449, #29523)
- Tab groups don't persist across reconnections
- **Mitigations:** Call `tabs_context_mcp` as heartbeat before each step; keep steps under 30s idle; detect "Browser extension is not connected" errors; avoid localStorage writes

**SSE testing strategy (from external research):**
- Do NOT intercept SSE at network level — fragile and poorly supported in Chrome automation
- Trigger action → poll DOM with `read_page`/`find` every 5-10s → assert final rendered state
- DOM polling doubles as connection heartbeat (keeps service worker alive)
- Check for error UI elements, not network failures (errors are delivered via SSE events)

**Staging environment:**
- URL: `food-test.lucaswall.me`
- Fitbit: dry-run mode (`FITBIT_DRY_RUN=true`) — logging doesn't hit real Fitbit API
- Auth: user's real Chrome session (Google OAuth + Fitbit already connected)

**GIF recording pattern:**
- `gif_creator` action: `start_recording` → take screenshots between steps → `stop_recording` → `export` with `download: true` and meaningful filename
- Take extra screenshots before/after actions for smooth playback
- Each scenario gets its own GIF file

### MCP Context
- **MCPs used:** Linear (issue tracking), Railway (production logs for timing data)
- **Findings:** Team "Food Scanner", prefix FOO-xxx. No existing staging QA issues in backlog. Production logs confirmed AI analysis takes 9-35s (not 5-15s as roadmap spec stated).

## Tasks

### Task 1: Create staging-qa skill with initial scenarios
**Linear Issue:** [FOO-898](https://linear.app/lw-claude/issue/FOO-898/create-staging-qa-skill-with-initial-4-scenarios)
**Files:**
- `.claude/skills/staging-qa/SKILL.md` (create)
- `.claude/skills/staging-qa/references/test-scenarios.md` (create)

**Steps:**
1. No TDD — this is a Claude Code skill (markdown files), not application code.
2. Create `.claude/skills/staging-qa/SKILL.md` with the following structure:

   **Frontmatter:**
   - `name: staging-qa`
   - `description:` Trigger on "staging qa", "run qa", "test staging". Describe purpose: automated functional QA against staging using Chrome browser automation.
   - `allowed-tools:` All 13 Chrome MCP tools listed in Context above, plus `Read`, `Glob`, `Grep` (for codebase reference during test validation)
   - `disable-model-invocation: true` — has browser side effects
   - `argument-hint: [scenarios]` — optional, to run specific scenarios instead of all
   - No `context: fork` — must maintain Chrome MCP connection from main conversation

   **Phase 1: Pre-flight** —
   - Call `tabs_context_mcp` to verify Chrome extension is connected. If error, STOP: "Chrome extension not connected. Run `/chrome` to connect, then re-run."
   - Create a new tab with `tabs_create_mcp`
   - Navigate to `food-test.lucaswall.me` using `navigate` tool
   - Verify the user is logged in by checking for the main navigation element (role: navigation, name: "Main navigation"). If login page is shown instead, STOP: "Not logged into staging. Please log in at food-test.lucaswall.me, then re-run."
   - Record the tab ID for all subsequent operations

   **Phase 2: Connection resilience protocol** —
   - Before EVERY browser tool call, call `tabs_context_mcp` as a heartbeat
   - If any browser tool returns a connection error: pause, inform user "Chrome connection lost. Please run `/chrome` to reconnect.", wait for user confirmation, then re-fetch tab context and resume from the current scenario
   - Never assume tab IDs persist after reconnection — always re-fetch via `tabs_context_mcp`
   - Avoid `javascript_tool` writes to localStorage/sessionStorage (triggers disconnection)

   **Phase 3: Scenario runner** —
   - Load scenario definitions from `references/test-scenarios.md`
   - If `$ARGUMENTS` specifies scenario names, filter to only those; otherwise run all
   - For each scenario:
     1. Start GIF recording (`gif_creator` action: `start_recording`)
     2. Take initial screenshot (`computer` action: `screenshot`)
     3. Execute scenario steps (from references file)
     4. Take final screenshot
     5. Stop GIF recording (`gif_creator` action: `stop_recording`)
     6. Export GIF with descriptive filename like `staging-qa-dashboard.gif` (`gif_creator` action: `export`, `download: true`)
     7. Record result: PASS, FAIL (with error details), or SKIP (if prerequisite failed)
   - If a scenario fails and subsequent scenarios depend on it (e.g., "delete entry" depends on "log entry"), mark dependents as SKIP

   **Phase 4: Cleanup** —
   - Navigate to history page
   - Search for any entries with "[QA Test]" in the name
   - Delete each test entry found
   - Verify entries are gone
   - If cleanup fails, report which entries remain for manual deletion

   **Phase 5: Report** —
   - Output a markdown summary to the conversation (NOT to a file):
     ```
     ## Staging QA Report — YYYY-MM-DD
     - Scenario 1: PASS/FAIL/SKIP
     - Scenario 2: PASS/FAIL/SKIP
     ...
     X/Y passed, N failed, M skipped
     ```
   - For failed scenarios, include: what was expected, what happened, screenshot context
   - Note any connection drops or reconnections that occurred

   **Rules section:**
   - All test entries must use "[QA Test]" prefix in food names for cleanup identification
   - SSE analysis waits: poll DOM every 5-10 seconds using `read_page` or `find`, total budget 90 seconds. Never use a single 30s `computer` wait — poll actively to keep connection alive.
   - Use `find` (natural language) for element discovery, `read_page` with `filter: "interactive"` for forms
   - Report only — this skill does not modify application code
   - Advisory — results do not gate deployments
   - Each scenario is independent unless explicitly chained (analyze → log → delete)

3. Create `.claude/skills/staging-qa/references/test-scenarios.md` with 4 initial scenarios:

   **Scenario 1: Dashboard loads** —
   - Navigate to `/app`
   - Verify main navigation is visible (accessibility role: navigation, name: "Main navigation")
   - Verify Daily/Weekly tab buttons are visible
   - Verify calorie data renders (any numeric content in the nutrition summary area — don't check exact values)
   - Check for console errors via `read_console_messages` with `onlyErrors: true`
   - Pass criteria: navigation visible, tabs visible, no console errors

   **Scenario 2: Analyze food (text-only, real AI)** —
   - Navigate to `/app/analyze`
   - Verify heading "Analyze Food" is visible
   - Find the description textarea (placeholder contains "e.g.")
   - Enter `[QA Test] Two scrambled eggs with toast` using `form_input`
   - Click "Analyze Food" button
   - **Wait for AI analysis:** Poll DOM every 8 seconds using `find` looking for a nutrition result (calorie number or food name heading). Total budget: 90 seconds. If timeout, FAIL.
   - Verify: a food name heading appeared, calorie value is displayed and is a reasonable number (50-2000 range), "Log to Fitbit" button is visible
   - Check console for errors
   - Pass criteria: analysis completes within 90s, nutrition data is structurally valid, no console errors

   **Scenario 3: Log to Fitbit (dry-run)** —
   - Depends on: Scenario 2 PASS (analysis result is on screen)
   - Click "Log to Fitbit" button
   - Wait for confirmation: poll DOM for `/logged successfully/i` text, budget 15 seconds
   - Verify "Done" button is visible
   - Click "Done" to return to dashboard
   - Navigate to history page and verify the "[QA Test]" entry appears in the list
   - Pass criteria: log succeeds, entry appears in history

   **Scenario 4: Delete test entry** —
   - Depends on: Scenario 3 PASS (entry exists in history)
   - In history, find the "[QA Test]" entry
   - Open the entry detail page
   - Find and click the delete button/action
   - Confirm deletion if a confirmation dialog appears
   - Navigate back to history
   - Verify the "[QA Test]" entry is no longer in the list
   - Pass criteria: entry deleted, no longer appears in history

   Each scenario definition should include:
   - Name, dependency (which prior scenarios must pass), steps with specific UI elements to interact with, pass/fail criteria, and expected timing

4. Run verifier (expect pass — no app code changed, just new markdown files)

**Notes:**
- Follow the skill structure pattern from `investigate/SKILL.md` (sequential phases, pre-flight checks, error handling table, rules section)
- Keep SKILL.md under 500 lines — detailed scenario steps belong in references/
- Reference the E2E test selectors from `e2e/tests/analyze.spec.ts` and `e2e/tests/dashboard.spec.ts` for known-good UI element identifiers
- The `find` tool uses natural language queries, making selectors self-healing by nature — prefer it over hardcoded CSS selectors
- The `read_page` tool with `filter: "interactive"` reduces output size and focuses on actionable elements

### Task 2: Register skill and update roadmap
**Linear Issue:** [FOO-899](https://linear.app/lw-claude/issue/FOO-899/register-staging-qa-skill-and-remove-from-roadmap)
**Files:**
- `CLAUDE.md` (modify)
- `ROADMAP.md` (modify)

**Steps:**
1. No TDD — documentation-only changes.
2. Add `staging-qa` to the SKILLS table in CLAUDE.md:
   - Skill: `staging-qa`
   - Model: Opus (inline skill)
   - Trigger: "staging qa", "run qa", "test staging"
   - What It Does: Chrome-driven functional QA against staging (dashboard, analyze, log, delete)
3. Remove the "AI-Driven Staging QA" section from ROADMAP.md:
   - Remove the row from the Contents table
   - Remove the entire feature section (from `## AI-Driven Staging QA` through the `---` separator after it)
   - Check remaining features for cross-references to `#ai-driven-staging-qa` and remove any found
4. Run verifier (expect pass — no app code changed)

**Notes:**
- Follow ROADMAP.md conventions section for removal procedure (update Contents table, fix cross-references)
- The SKILLS table in CLAUDE.md is in the SKILLS section — insert in alphabetical order or after existing entries

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Create a standalone `/staging-qa` Claude Code skill that automates functional QA against the staging site using Chrome browser automation, with GIF recording of each scenario.
**Linear Issues:** FOO-898, FOO-899
**Approach:** Create a new skill in `.claude/skills/staging-qa/` with SKILL.md (framework, phases, rules) and `references/test-scenarios.md` (4 initial scenarios: dashboard, analyze, log, delete). The skill uses the `claude-in-chrome` MCP tools to navigate the real staging site with the user's authenticated session. Each scenario is GIF-recorded. Start with a 4-scenario subset covering the core happy path; remaining 5 scenarios (chat refinement, history browsing, edit, quick-select, settings) can be added incrementally. Update CLAUDE.md to register the skill and remove the feature from ROADMAP.md.
**Scope:** 2 tasks, 4 files (2 create, 2 modify), no tests (markdown-only changes)
**Key Decisions:** Standalone skill (not integrated into push-to-production); GIF recording per scenario; 4-scenario initial subset; 90-second wait budget for AI analysis (based on real production timings of 9-35s); active DOM polling every 8s as both assertion and connection heartbeat; "[QA Test]" prefix for test entry identification and cleanup
**Risks:** Low — no application code changes, no regression risk. Main operational risk is Chrome extension connection stability during longer AI analysis waits (mitigated by heartbeat protocol and reconnection instructions).
