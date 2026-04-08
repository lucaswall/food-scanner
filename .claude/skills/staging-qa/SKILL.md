---
name: staging-qa
description: Automated functional QA against the staging site using Chrome browser automation. Trigger on "staging qa", "run qa", "test staging". Navigates the real staging app, runs test scenarios with GIF recording, and reports results.
argument-hint: "[gif] [scenarios] — 'gif' enables GIF recording per scenario. Scenario names filter which to run (e.g., 'gif dashboard analyze'). Omit to run all without GIFs."
allowed-tools: Read, Glob, Grep, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__form_input, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__javascript_tool, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__read_network_requests, mcp__claude-in-chrome__gif_creator, mcp__claude-in-chrome__resize_window
disable-model-invocation: true
---

ultrathink

Automated functional QA against the live staging site (`food-test.lucaswall.me`) using Chrome browser automation. Runs test scenarios, cleans up test data, and reports results. GIF recording is optional.

## Phase 1: Pre-flight

1. **Verify Chrome extension** — Call `tabs_context_mcp` to check the Chrome extension is connected.
   - If error → STOP: "Chrome extension not connected. Open Chrome, ensure the Claude Code extension is active, then re-run `/staging-qa`."

2. **Create a new tab** — Use `tabs_create_mcp` to open a fresh tab. Record the tab ID for all subsequent operations.

3. **Navigate to staging** — Use `navigate` to go to `https://food-test.lucaswall.me/app`.

4. **Verify login** — Use `read_page` or `find` to check for the main navigation element (role: navigation, name: "Main navigation").
   - If login page is shown instead → STOP: "Not logged into staging. Please log in at food-test.lucaswall.me, then re-run `/staging-qa`."

5. **Set mobile viewport** — Use `resize_window` to set the viewport to **390×844** (iPhone 14 equivalent). The app is used 100% on mobile — all scenarios must run at mobile width.

6. **Record tab ID** — Store the tab ID for use in all subsequent browser tool calls.

## Phase 2: Connection Resilience Protocol

Apply these rules throughout ALL browser interactions:

- **Heartbeat before every step:** Call `tabs_context_mcp` before each browser tool call. This keeps the Chrome MV3 service worker alive (it terminates after ~30s idle).
- **Connection error handling:** If any browser tool returns a connection error or "Browser extension is not connected":
  1. Inform user: "Chrome connection lost. Please ensure the extension is active, then confirm to continue."
  2. Wait for user confirmation.
  3. Call `tabs_context_mcp` to re-establish context.
  4. Re-fetch the current tab ID (tab IDs may change after reconnection).
  5. Resume from the current scenario step.
- **Never assume tab IDs persist** after any connection interruption — always re-fetch via `tabs_context_mcp`.
- **Avoid localStorage/sessionStorage writes** via `javascript_tool` — these can trigger immediate disconnection (known issue #27597).

## Phase 3: Scenario Runner

1. **Load scenarios** — Read `references/test-scenarios.md` for scenario definitions.

2. **Parse arguments** — If `$ARGUMENTS` is provided, split on whitespace. Extract the `gif` keyword (enables GIF recording). Remaining tokens are scenario slug names to filter. Valid slugs: `dashboard`, `weekly`, `analyze`, `refine`, `log`, `delete`, `quick-select`, `food-detail`, `edit`, `labels`, `settings`, `chat`. If no slug tokens, run all scenarios in order.

3. **For each scenario:**

   a. **Check dependencies** — If the scenario depends on a prior scenario that FAILED or was SKIPPED, mark this scenario as SKIP with reason "dependency [scenario-name] failed".

   b. **If GIF mode:** Start GIF recording — call `gif_creator` with action `start_recording`.

   c. **Take initial screenshot** — Call `computer` with action `screenshot` to capture the starting state.

   d. **Execute scenario steps** — Follow the step-by-step instructions from the scenario definition. Between each step:
      - Call `tabs_context_mcp` (heartbeat)
      - Take a screenshot after significant state changes (for smooth GIF playback if recording)

   e. **Evaluate pass/fail** — Check the scenario's pass criteria. Record the result.

   f. **Take final screenshot** — Capture the end state.

   g. **If GIF mode:** Stop and export GIF — call `gif_creator` with action `stop_recording`, then `export` with `download: true` and filename `staging-qa-{scenario-slug}.gif`.

   h. **Record result** — PASS, FAIL (with error details), or SKIP (with reason).

4. **Continue to next scenario** regardless of the previous result (unless the next depends on it).

### SSE / AI Analysis Wait Strategy

When waiting for AI results (analyze, refine, edit scenarios):
- **Poll actively** using `find` or `read_page` every **8 seconds**.
- **Total budget: 90 seconds** (real AI analysis takes 9-35s on staging).
- **Each poll doubles as a heartbeat** — keeps the Chrome service worker alive.
- **Never use a single long `computer` wait** — the 30s max would kill the connection.
- **Check for error states** in the DOM (error messages, error toasts) at each poll — fail fast if the analysis errored.

## Phase 4: Cleanup

After all scenarios complete (regardless of pass/fail):

1. **Navigate to history** — Go to `/app/history`.
2. **Search for test entries** — Look for any entries containing "[QA Test]" in the food name.
3. **Delete each test entry:**
   - Open the entry detail page
   - Find and click the delete action
   - Confirm deletion if prompted
   - Return to history
4. **Verify cleanup** — Confirm no "[QA Test]" entries remain.
5. **Report cleanup status** — If any entries couldn't be deleted, list them so the user can clean up manually.

**Note:** Cleanup runs even if scenarios failed — test data should never persist.

## Phase 5: Report

Output a markdown summary to the conversation (NOT to a file):

```
## Staging QA Report — YYYY-MM-DD

| Scenario | Result | Details |
|----------|--------|---------|
| Dashboard loads | PASS/FAIL/SKIP | |
| Weekly view | PASS/FAIL/SKIP | |
| Analyze food | PASS/FAIL/SKIP | |
| Refine with chat | PASS/FAIL/SKIP | |
| Log to Fitbit | PASS/FAIL/SKIP | |
| Delete test entry | PASS/FAIL/SKIP | |
| Quick Select | PASS/FAIL/SKIP | |
| Food detail | PASS/FAIL/SKIP | |
| Edit entry | PASS/FAIL/SKIP | |
| Labels page | PASS/FAIL/SKIP | |
| Settings page | PASS/FAIL/SKIP | |
| Chat page | PASS/FAIL/SKIP | |

**Summary:** X/Y passed, N failed, M skipped
**Cleanup:** [All test entries removed / N entries remain for manual cleanup]
**Connection:** [No drops / N reconnections during run]
**GIF recordings:** [list of GIF filenames, or "disabled"]
```

For failed scenarios, include:
- What was expected
- What actually happened
- Which step failed

## Error Handling

| Situation | Action |
|-----------|--------|
| Chrome extension not connected | STOP — ask user to activate extension |
| Not logged into staging | STOP — ask user to log in |
| Connection lost mid-scenario | Pause, inform user, wait for reconnection, resume |
| AI analysis timeout (>90s) | FAIL the scenario, continue to next |
| Element not found | Retry once after 3s, then FAIL |
| Unexpected page state | Take screenshot, FAIL with description |
| Cleanup fails | Report remaining entries, don't block the report |
| Tab closed by user | Re-create tab, resume from current scenario |

## Rules

- **All test entries use "[QA Test]" prefix** in food names for identification and cleanup.
- **SSE analysis waits: poll DOM every 8 seconds**, total budget 90 seconds. Never use a single long wait.
- **Use `find` (natural language)** for element discovery — self-healing by nature, no brittle CSS selectors.
- **Use `read_page` with `filter: "interactive"`** for form interactions — reduces output size.
- **Report only** — this skill does NOT modify application code.
- **Advisory** — results do not gate deployments.
- **Each scenario is independent** unless explicitly chained via dependencies.
- **Always clean up** — delete test entries even if scenarios failed.
- **GIF recording is opt-in** — only enabled when `gif` is in `$ARGUMENTS`. Each scenario gets its own recording with a descriptive filename.
- **Heartbeat before every browser call** — `tabs_context_mcp` keeps the connection alive.
- **No localStorage writes** — avoid `javascript_tool` writes to storage (triggers disconnection).

## What NOT to Do

1. **Don't modify code** — this skill only tests the staging site
2. **Don't write results to files** — report to the conversation only
3. **Don't use hardcoded CSS selectors** — use `find` with natural language
4. **Don't use single long waits** — always poll actively
5. **Don't skip cleanup** — test data must be removed
6. **Don't gate deployments** — results are advisory
