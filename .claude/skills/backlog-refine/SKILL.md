---
name: backlog-refine
description: Refine vague Linear Backlog issues into well-specified, actionable items. Use when user says "refine backlog", "refine FOO-123", "improve backlog items", or "clarify issues". Fetches Backlog issues, analyzes gaps, asks clarifying questions, and updates Linear after user confirms.
argument-hint: [FOO-123 FOO-124 or blank for picker]
allowed-tools: Read, Glob, Grep, AskUserQuestion, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__update_issue, mcp__linear__create_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Refine vague Backlog issues into well-specified, actionable items through interactive discussion with the user.

## Pre-flight

1. **Verify Linear MCP** — Call `mcp__linear__list_teams`. If unavailable, STOP and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill."
2. **Read CLAUDE.md** — Load project conventions for context.

## Input Handling

### Mode 1: Specific Issues ($ARGUMENTS contains issue identifiers)

Parse issue identifiers from `$ARGUMENTS` (e.g., `FOO-123`, `FOO-124`).
- Fetch each issue using `mcp__linear__get_issue`
- Continue to Analysis phase

### Mode 2: No Arguments (picker mode)

If `$ARGUMENTS` is empty or doesn't contain issue identifiers:
1. Fetch all Backlog issues: `mcp__linear__list_issues` with `team: "Food Scanner"`, `state: "Backlog"`
2. Score each issue's refinement readiness (see Refinement Score below)
3. Display a markdown table with columns: #, Issue, Title, Priority, Labels, Score
4. Present to user using `AskUserQuestion`:
   - Include the score in each option's description (e.g., "Screen to show food logged by date — Feature — Score: 3/5")
   - Let user pick which issues to refine
5. Fetch full details for selected issues

### Refinement Score

Rate each issue 1–5 based **only** on the data returned from `list_issues` (title, description, priority, labels). Do NOT read source files or fetch full details for scoring — this is a quick triage.

| Score | Meaning | Criteria |
|-------|---------|----------|
| 5 | Ready | Has problem statement, context, acceptance criteria, correct priority/labels |
| 4 | Minor gaps | Missing one of: acceptance criteria, implementation hints, or specificity |
| 3 | Needs work | Vague description, missing context or impact, but intent is clear |
| 2 | Unclear | Very short description, no acceptance criteria, scope ambiguous |
| 1 | Stub | Title only or single sentence, no useful detail |

**Scoring checklist** (deduct 1 point from 5 for each gap):
- Description is ≤1 sentence with no specifics → −1
- No acceptance criteria or definition of done → −1
- No affected files/routes/components mentioned → −1
- Scope is ambiguous (could mean multiple things) → −1
- Priority or labels seem mismatched with description → −1

Minimum score is 1. Issues scoring 5 can still be selected — refinement may find minor improvements after reading full details and source code.

## Analysis Phase

For each issue, analyze and identify gaps. Read relevant source files referenced in the issue description to understand context.

Check for these common problems in Backlog issues:

### Vagueness Checks
- **Missing problem statement** — Does the description explain what's wrong or missing?
- **Missing context** — Are affected files, routes, or components identified?
- **Missing impact** — Is it clear why this matters (user impact, data quality, errors)?
- **Missing acceptance criteria** — How would you know this is done?
- **Scope too broad** — Should this be split into multiple focused issues?
- **Scope too narrow** — Is this really a sub-task of a larger issue?

### Quality Checks
- **Wrong priority** — Does the priority match the actual impact?
- **Wrong/missing labels** — Does the label correctly categorize the issue?
- **Duplicate or overlapping** — Does another Backlog issue cover the same ground?
- **Outdated** — Has the referenced code changed since the issue was created?
- **Missing implementation hints** — Could helpful pointers be added for `plan-todo`?

### Codebase Cross-Reference
- If the issue mentions specific files/areas, read them to verify the problem still exists
- If the issue is vague about location, search the codebase to identify affected areas
- Note any related code patterns that provide useful context

## Discussion Phase

For each issue, present your analysis to the user:

```
## FOO-123: [Current Title]

**Current state:**
[Brief summary of what the issue says now]

**Issues found:**
- [Gap 1: e.g., "No acceptance criteria — unclear when this is done"]
- [Gap 2: e.g., "Description says 'improve error handling' but doesn't specify which errors"]
- [Gap 3: e.g., "Priority is Low but this is a security concern — should be High"]

**Suggested improvements:**
- [Suggestion 1: e.g., "Add specific error scenarios to handle"]
- [Suggestion 2: e.g., "Split into two issues: API errors vs UI errors"]
- [Suggestion 3: e.g., "Bump priority to High (Security label)"]

**Questions for you:**
- [Question 1: e.g., "Should this cover both API and UI error handling, or just API?"]
- [Question 2: e.g., "Is there a specific error you've seen that triggered this issue?"]
```

Then engage in a back-and-forth discussion:
- Ask clarifying questions to fill gaps
- Suggest concrete improvements based on codebase knowledge
- Propose title rewording if current title is vague
- Recommend priority/label changes if warranted
- Suggest splitting if scope is too broad (see Splitting Issues below)
- Flag if the issue might be outdated or already fixed

Continue the discussion until the user says they're done or confirms the refinements.

### Splitting Issues

When an issue covers multiple distinct problems or its scope is too broad, suggest splitting it. During discussion, propose the split clearly:

```
**Suggested split for FOO-123:**
This issue covers both API error handling and UI error display. I'd suggest splitting:

1. **FOO-123 (updated):** "API routes return generic 500 on upload failures"
   - Label: Bug, Priority: High
2. **New issue:** "Upload UI shows no feedback on server errors"
   - Label: Improvement, Priority: Medium
```

If the user agrees to a split:
- The **original issue** (FOO-123) is updated to become the first split item (new title, description, priority, labels)
- **New issues** are created via `mcp__linear__create_issue` for the remaining split items, all in `state: "Backlog"` with proper labels and priorities
- Each split issue gets a full refined description (using the standard format)

## Update Phase

When the user confirms they're done refining:

1. **Show the update preview** — Present the final version of each issue:

```
## Updates to apply:

### FOO-123 (update)
- **Title:** [Original] → [New title, if changed]
- **Description:** [Full new description]
- **Priority:** [Original] → [New, if changed]
- **Labels:** [Original] → [New, if changed]

### New issue (split from FOO-123)
- **Title:** [Title]
- **Description:** [Full description]
- **Priority:** [Priority]
- **Labels:** [Labels]

### FOO-124 (update)
...
```

2. **Wait for confirmation** — Ask user to confirm before updating.

3. **Apply updates:**
   - Use `mcp__linear__update_issue` for each updated issue (title, description, priority, labels)
   - Use `mcp__linear__create_issue` for each new split issue with `team: "Food Scanner"`, `state: "Backlog"`, and proper labels/priority

### Refined Description Format

Use this structure for updated descriptions:

```
**Problem:**
[Clear, specific problem statement — 1-2 sentences]

**Context:**
[Affected files, routes, or components — be specific]

**Impact:**
[Why this matters — user-facing impact, data quality, security, etc.]

**Acceptance Criteria:**
- [ ] [Specific, verifiable criterion]
- [ ] [Another criterion]

**Implementation Hints:** (optional)
[Pointers for plan-todo: patterns to follow, related code, constraints]
```

## Processing Multiple Issues

When refining multiple issues:
- Process one at a time to keep discussion focused
- After completing discussion on one issue, move to the next
- At the end, show all updates together for a single confirmation

## Error Handling

| Situation | Action |
|-----------|--------|
| Linear MCP not connected | STOP — tell user to run `/mcp` |
| Issue ID not found | Tell user, skip that issue |
| No Backlog issues exist | Tell user "No Backlog issues found" and stop |
| User picks no issues | Stop gracefully |
| Referenced code doesn't exist anymore | Note as potentially outdated in analysis |
| Issue already well-specified | Tell user it looks good, suggest minor tweaks if any |

## Rules

- **Discussion-driven** — Always engage the user, don't auto-refine silently
- **Confirm before updating** — Show preview of all changes before applying
- **Preserve user intent** — Refine the issue, don't change its fundamental purpose
- **One issue at a time** — Keep discussion focused during analysis
- **No code changes** — This skill only updates Linear issues

## Termination

After applying updates, output:

```
Refinement complete.

Updated X issues:
- FOO-123: [New title] — [brief summary of changes]
- FOO-124: [New title] — [brief summary of changes]

Created Y issues (from splits):
- FOO-130: [Title] (split from FOO-123) — [Label, Priority]
- FOO-131: [Title] (split from FOO-124) — [Label, Priority]

Unchanged:
- FOO-125: Already well-specified

Next step: Use `plan-todo FOO-123` to create an implementation plan.
```

Do not ask follow-up questions after termination.
