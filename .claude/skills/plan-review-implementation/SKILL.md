---
name: plan-review-implementation
description: QA review of completed implementation using an agent team with 3 domain-specialized reviewers (security, reliability, quality). Use after plan-implement finishes, or when user says "review the implementation". Moves Linear issues Review→Merge. Creates new issues in Todo for bugs found. Falls back to single-agent mode if agent teams unavailable.
allowed-tools: Read, Edit, Glob, Grep, Bash, Task, TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Review **ALL** implementation iterations that need review using an agent team with domain-specialized reviewers. You are the **team lead/coordinator**. You orchestrate 3 reviewer teammates who review changed files in parallel through different lenses, then you merge findings, document them, and handle Linear/git.

**If agent teams are unavailable** (TeamCreate fails), fall back to single-agent mode — see "Fallback: Single-Agent Mode" section.

**Reference:** See [references/code-review-checklist.md](references/code-review-checklist.md) for comprehensive checklist.

## Pre-flight Check

1. **Read PLANS.md** — Understand the full plan and iteration history
2. **Read CLAUDE.md** — Understand project standards and conventions
3. **Verify Linear MCP** — Call `mcp__linear__list_teams`. If unavailable, STOP and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill."
4. **Assess AI-generated code risk** — If implementation is large or shows AI patterns, apply extra scrutiny

## Linear State Management

This skill moves issues from **Review → Merge** (preparing for PR).

**If task passes review (no issues):**
- Move issue from "Review" to "Merge" using `mcp__linear__update_issue`

**If task needs fixes (issues found):**
- Move original issue from "Review" to "Merge" (the original task was completed)
- Create NEW Linear issue(s) in "Todo" for each bug/fix using `mcp__linear__create_issue`:
  - `team`: "Food Scanner"
  - `state`: "Todo" (will enter PLANS.md via Fix Plan)
  - `labels`: Bug
- Add new issue links to the Fix Plan section in PLANS.md
- These new issues will go through the full cycle when plan-implement runs the Fix Plan

## Identify What to Review

**Detection logic:**

1. Search PLANS.md for `## Iteration N` sections
2. **If iterations exist:** Build list of iterations needing review:
   - Has "Tasks Completed This Iteration" or "### Completed" subsection
   - Does NOT contain `<!-- REVIEW COMPLETE -->` marker
   - Process in order (Iteration 1 first, then 2, etc.)
3. **If NO iterations exist:** Treat entire plan as single iteration:
   - Look for "Completed" or "### Completed" section at plan level
   - Check if plan already has `<!-- REVIEW COMPLETE -->` marker
   - If completed but not reviewed → review as "Iteration 1"

**Iteration detection:** A plan has iterations if it contains `## Iteration` (with or without number).

An iteration is **READY FOR REVIEW** when it has "Tasks Completed This Iteration" (or legacy "### Completed") section and does NOT have `<!-- REVIEW COMPLETE -->` marker yet. The presence of `### Tasks Remaining` does NOT affect review readiness — review covers only the **completed tasks**.

If no iteration/plan needs review → Inform user and stop.

**Important:** Review ALL pending iterations in a single session, not just one.

## Collect Changed Files

From each iteration's "Tasks Completed This Iteration" (or legacy "Completed") section, list all files that were created, modified, or had tests added. This is the **review scope** — reviewers examine ONLY these files.

## Team Setup

### Create the team

Use `TeamCreate`:
- `team_name`: "plan-review"
- `description`: "Parallel implementation review with domain-specialized reviewers"

**If TeamCreate fails**, switch to Fallback: Single-Agent Mode (see below).

### Create tasks

Use `TaskCreate` to create 3 review tasks:

1. **"Security review"** — Security & auth review of changed files
2. **"Reliability review"** — Bugs, async, resources, edge cases in changed files
3. **"Quality review"** — Type safety, conventions, test quality in changed files

### Spawn 3 reviewer teammates

Use the `Task` tool with `team_name: "plan-review"`, `subagent_type: "general-purpose"`, and `model: "sonnet"` to spawn each reviewer. Spawn all 3 in parallel (3 concurrent Task calls in one message).

Each reviewer prompt MUST include:
- The common preamble and their domain checklist from [references/reviewer-prompts.md](references/reviewer-prompts.md)
- The **exact list of changed files** to review (from Collect Changed Files step)
- Instructions to report findings as a structured message to the lead

### Assign tasks

After spawning, use `TaskUpdate` to assign each task to its reviewer by name.

## Coordination

While waiting for reviewer messages:
1. Reviewer messages are **automatically delivered** — do NOT poll or manually check inbox
2. Teammates go idle after each turn — this is normal, not an error. They're done when they send their findings message.
3. Track progress via `TaskList`
4. Acknowledge receipt as each reviewer reports
5. Wait until ALL 3 reviewers have reported before proceeding to merge

**If a reviewer gets stuck or stops without reporting:** Send them a message asking for their findings. If they don't respond, note that domain as "incomplete".

## Merge & Evaluate Findings

Once all reviewer findings are collected:

### Deduplicate
- Same code location reported by multiple reviewers → merge into the one with higher priority
- Same root cause in multiple locations → combine into one finding

### Evaluate Severity

| Severity | Criteria | Action |
|----------|----------|--------|
| **CRITICAL** | Security vulnerabilities, data corruption, crashes | Must fix before merge |
| **HIGH** | Logic errors, race conditions, auth issues, resource leaks | Must fix before merge |
| **MEDIUM** | Edge cases, type safety, error handling gaps | Should fix |
| **LOW** | Convention violations, style (only if egregious) | Document only |

**Fix Required (CRITICAL/HIGH):**
- Would cause runtime errors or crashes
- Could corrupt or lose data
- Security vulnerability (OWASP categories)
- Resource leak affecting production
- Test doesn't actually test the behavior
- Violates CLAUDE.md critical rules

**Document Only (MEDIUM/LOW):**
- Edge cases unlikely to occur
- Style preferences not in CLAUDE.md
- "Nice to have" improvements

## Document Findings

### If Issues Found (CRITICAL/HIGH)

Add Review Findings to the current Iteration section, then add Fix Plan at h2 level AFTER the iteration:

```markdown
### Review Findings

Summary: N issue(s) found (Team: security, reliability, quality reviewers)
- CRITICAL: X
- HIGH: Y
- MEDIUM: Z (documented only)

**Issues requiring fix:**
- [CRITICAL] SECURITY: SQL injection in query builder (`src/db.ts:45`) - OWASP A03:2021
- [HIGH] BUG: Race condition in cache invalidation (`src/cache.ts:120`)

**Documented (no fix needed):**
- [MEDIUM] EDGE CASE: Unicode filenames not tested (`src/upload.ts:30`)

### Linear Updates
- FOO-123: Review → Merge (original task completed)
- FOO-125: Created in Todo (Fix: SQL injection)
- FOO-126: Created in Todo (Fix: Race condition)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration N
**Linear Issues:** [FOO-125](...), [FOO-126](...)

### Fix 1: SQL injection in query builder
**Linear Issue:** [FOO-125](...)

1. Write test in `src/db.test.ts` for malicious input escaping
2. Use parameterized query in `src/db.ts:45`

### Fix 2: Race condition in cache invalidation
**Linear Issue:** [FOO-126](...)

1. Write test in `src/cache.test.ts` for concurrent invalidation
2. Add mutex/lock in `src/cache.ts:120`
```

**Note:** `<!-- REVIEW COMPLETE -->` is added even when issues are found — the review itself is complete. Fix Plan is at h2 level so `plan-implement` can find it.

### If No Issues Found

```markdown
### Review Findings

Files reviewed: N
Reviewers: security, reliability, quality (agent team)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-123: Review → Merge
- FOO-124: Review → Merge

<!-- REVIEW COMPLETE -->
```

**Then continue to the next iteration needing review.**

## Shutdown Team

After documenting findings for the current batch of iterations:
1. Send shutdown requests to all 3 reviewers using `SendMessage` with `type: "shutdown_request"`
2. Wait for shutdown confirmations
3. Use `TeamDelete` to remove team resources

## After ALL Iterations Reviewed

### Collect Skipped Findings

Before determining final status, scan ALL `<!-- REVIEW COMPLETE -->` iteration sections for "Documented (no fix needed)" entries. These are findings that were evaluated as MEDIUM/LOW and documented but not fixed.

If any documented-only findings exist across any iteration, prepare a **Skipped Findings Summary** to be appended just before `## Status: COMPLETE`.

- **If Fix Plan exists OR tasks remain unfinished** → Do NOT mark complete. More implementation needed.
  1. **Commit and push** (see Termination section)
  2. Inform user: "Review complete. Changes committed and pushed. Run `/plan-implement` to continue implementation."

- **If all tasks complete and no issues** → Run E2E tests, update header status, append final status, then create PR:
  1. **Run E2E tests** using the verifier agent in E2E mode:
     ```
     Use Task tool with subagent_type "verifier" with prompt "e2e"
     ```
     If E2E tests fail, do NOT mark complete — create new Linear issues in Todo for the failures (same as review findings), add a Fix Plan, commit/push, and inform user to run `/plan-implement`.
  2. **Update the header** on line 3: change `**Status:** IN_PROGRESS` to `**Status:** COMPLETE`
  3. **Append** the final status section at the bottom of the file
  4. If skipped findings exist, insert the summary before the status marker:

```markdown
---

## Skipped Findings Summary

Findings documented but not fixed across all review iterations:

| Severity | Category | File | Finding | Rationale |
|----------|----------|------|---------|-----------|
| MEDIUM | EDGE CASE | `src/upload.ts:30` | Unicode filenames not tested | Unlikely in current usage |

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
```

**Note:** The Skipped Findings Summary section is only added when documented-only findings actually exist. If all iterations passed clean, omit it entirely.

**Then create the PR:**
1. Commit any uncommitted changes
2. Push to remote
3. Create PR using the `pr-creator` subagent
4. Inform user with PR URL

## Fallback: Single-Agent Mode

If `TeamCreate` fails, perform the review as a single agent:

1. **Inform user:** "Agent teams unavailable. Running review in single-agent mode."
2. For each iteration needing review:
   a. Identify changed files from "Tasks Completed This Iteration"
   b. Read each file and apply checks from [references/code-review-checklist.md](references/code-review-checklist.md)
   c. Apply all domain checks (security, reliability, quality) sequentially
   d. Document findings (same format as team mode)
   e. Handle Linear updates (same as team mode)
3. Continue with "After ALL Iterations Reviewed" section

## Context Management & Continuation

**Context is checked ONLY at iteration boundaries.** Never stop mid-iteration review.

**After completing each iteration review**, estimate remaining context:
- If **> 60%** → Continue to next pending iteration
- If **<= 60%** → Stop, commit/push, inform user to re-run

**Never stop mid-iteration** — once started, complete the full review for that iteration.

## Issue Categories Reference

| Tag | Description | Default Severity |
|-----|-------------|------------------|
| `SECURITY` | Injection, auth bypass, secrets exposure, IDOR | CRITICAL/HIGH |
| `BUG` | Logic errors, off-by-one, null handling | HIGH |
| `ASYNC` | Unhandled promises, race conditions | HIGH |
| `RESOURCE` | Memory/resource leaks, missing cleanup | HIGH |
| `TIMEOUT` | Missing timeouts, potential hangs | HIGH/MEDIUM |
| `EDGE CASE` | Unhandled scenarios, boundary conditions | MEDIUM |
| `TYPE` | Unsafe casts, missing type guards | MEDIUM |
| `ERROR` | Missing or incorrect error handling | MEDIUM |
| `CONVENTION` | CLAUDE.md violations | LOW-MEDIUM |

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md doesn't exist | Stop — "No plan found." |
| No iteration needs review | Stop — "No iteration to review. Run plan-implement first." |
| Plan has no iterations | Treat entire plan as single iteration |
| Files in iteration don't exist | Note as issue — implementation may have failed |
| CLAUDE.md doesn't exist | Use general coding best practices |
| TeamCreate fails | Switch to single-agent fallback mode |
| Reviewer stops without reporting | Send follow-up message, note domain as incomplete |
| Too many issues found | Prioritize by severity, create fix plan for critical/high only |

## Termination: Commit, Push, and PR

**MANDATORY:** Before ending, commit all local changes and push to remote.

### For Incomplete Plans
1. Stage modified files: `git status --porcelain=v1`, then `git add <file> ...` — **skip** `.env*`, `*.key`, `*.pem`, `credentials*`, `secrets*`
2. Commit (no `Co-Authored-By` tags): `plan: review iteration N - [issues found | no issues]`
3. `git push`
4. Inform user to run `/plan-implement`

### For Complete Plans
1. Stage modified files: `git status --porcelain=v1`, then `git add <file> ...` — **skip** `.env*`, `*.key`, `*.pem`, `credentials*`, `secrets*`
2. Commit (no `Co-Authored-By` tags): `plan: mark [plan-name] complete`
3. `git push`
4. Create PR using the `pr-creator` subagent
5. Inform user with PR URL

**Branch handling:** Assumes plan-implement already created a feature branch. If on `main`, create branch first.

## Rules

- **Review ALL pending iterations** — Don't stop after one
- **Do not modify source code** — Review only, document findings
- **Be specific** — Include file paths and line numbers for every issue
- **One fix per issue** — Each finding must have a matching Fix task with Linear issue
- **Fix Plan follows TDD** — Test first for each fix
- **Never modify previous sections** — Only add to current iteration or append status
- **Mark COMPLETE only when ALL iterations pass** — No fix plans pending, all reviewed
- **Move issues to Merge** — All reviewed issues that pass go Review→Merge
- **Create bug issues in Todo** — All bugs found create new issues in Todo state
- **Always commit and push at termination** — Never end without committing progress
- **Create PR when plan is complete** — Use pr-creator subagent for final PR
- **Lead handles all Linear/git writes** — Reviewers NEVER create issues or modify PLANS.md
- **No co-author attribution** — Commit messages must NOT include `Co-Authored-By` tags
- **Never stage sensitive files** — Skip `.env*`, `*.key`, `*.pem`, `credentials*`, `secrets*`
- **Check MIGRATIONS.md** — If implementation changed DB schema, column names, session/token formats, or env vars, verify that `MIGRATIONS.md` has a corresponding note. If missing, add it as a MEDIUM finding: "Missing MIGRATIONS.md entry for [change description]". The lead should append the missing note to `MIGRATIONS.md` before committing.
- **Always append Skipped Findings Summary when documented-only findings exist** — Before marking a plan COMPLETE, scan all `<!-- REVIEW COMPLETE -->` sections for "Documented (no fix needed)" entries and include the summary table if any exist
