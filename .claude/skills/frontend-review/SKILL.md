---
name: frontend-review
description: Reviews all frontend elements (UI, UX, accessibility, visual design, responsiveness, performance) using an agent team with 3 domain-specialized reviewers. Creates Linear issues in Backlog state for findings. Use when user says "review frontend", "check UI", "review UX", "audit accessibility", "check responsive", or "review screens". Falls back to single-agent mode if agent teams unavailable.
argument-hint: [optional: specific area like "settings page" or "photo capture"]
allowed-tools: Read, Glob, Grep, Task, Bash, TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Review all frontend elements using an agent team with domain-specialized reviewers. You are the **team lead/coordinator**. You orchestrate 3 reviewer teammates who examine the frontend through different lenses in parallel, then you merge findings, create Linear issues, and output a summary report.

**If agent teams are unavailable** (TeamCreate fails), fall back to single-agent mode — see "Fallback: Single-Agent Mode" section.

**Reference:** See [references/frontend-checklist.md](references/frontend-checklist.md) for the comprehensive checklist and [references/reviewer-prompts.md](references/reviewer-prompts.md) for domain-specific reviewer instructions.

## Pre-flight

1. **Verify Linear MCP** — Call `mcp__linear__list_teams`. If unavailable, STOP and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill."
2. **Read CLAUDE.md** — Load project standards, tech stack, and conventions
3. **Discover frontend files** — Use Glob to find all frontend-related files:
   - `src/app/**/page.tsx` — Pages
   - `src/app/**/layout.tsx` — Layouts
   - `src/components/**/*.tsx` — Components
   - `src/hooks/**/*.ts` — Custom hooks
   - `src/app/globals.css` — Styles
   - `public/manifest.json` — PWA manifest
   - `middleware.ts` — Middleware
4. **Determine review scope:**
   - If `$ARGUMENTS` specifies an area → scope files to that area only
   - If no arguments → review all frontend files
5. **Build the file list** — Create the exact list of files each reviewer will examine

## Team Setup

### Create the team

Use `TeamCreate`:
- `team_name`: "frontend-review"
- `description`: "Parallel frontend review with domain-specialized reviewers"

**If TeamCreate fails**, switch to Fallback: Single-Agent Mode (see below).

### Create tasks

Use `TaskCreate` to create 3 review tasks:

1. **"Accessibility & semantics review"** — WCAG compliance, ARIA, semantic HTML, keyboard nav, screen readers
2. **"Visual design & UX review"** — Design consistency, layout, responsive design, mobile UX, user flows
3. **"Performance & optimization review"** — Core Web Vitals, images, bundle, Server/Client components, PWA

### Spawn 3 reviewer teammates

Use the `Task` tool with `team_name: "frontend-review"`, `subagent_type: "general-purpose"`, and `model: "sonnet"` to spawn each reviewer. Spawn all 3 in parallel (3 concurrent Task calls in one message).

Each reviewer prompt MUST include:
- The common preamble and their domain checklist from [references/reviewer-prompts.md](references/reviewer-prompts.md)
- The **exact list of files** to review (from the pre-flight file discovery)
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
- Same component/element reported by multiple reviewers → merge into the one with higher priority
- Same root cause across multiple locations → combine into one finding

### Evaluate Severity

| Severity | Criteria | Examples |
|----------|----------|---------|
| **CRITICAL** | Blocks usage for some users entirely | Missing keyboard navigation on core flow, zero-contrast text, broken responsive layout on mobile |
| **HIGH** | Significant UX degradation or accessibility barrier | Missing ARIA labels on interactive elements, no focus indicators, touch targets below 44px, missing loading states, LCP > 4s |
| **MEDIUM** | Noticeable but not blocking | Inconsistent spacing, minor contrast issues on non-critical text, missing skip links, CLS > 0.1 |
| **LOW** | Polish and best-practice improvements | Inconsistent border radius, missing hover transitions, suboptimal image format |

## Create Linear Issues

After merging and deduplicating, create a Linear issue for each finding using `mcp__linear__create_issue`:

```
team: "Food Scanner"
state: "Backlog"
title: "[Brief description of the issue]"
description: (see Issue Description Format below)
priority: [1|2|3|4] (mapped from severity)
labels: [Mapped label(s)]
```

**Issue Description Format:**

```
**Problem:**
[Clear, specific problem statement — 1-2 sentences]

**Context:**
[Affected file paths with line numbers, e.g. `src/components/food-analyzer.tsx:45-60`]

**Impact:**
[Who is affected and how — e.g. screen reader users, mobile users, slow connections]

**Fix:**
[Specific remediation steps — what needs to change]

**Acceptance Criteria:**
- [ ] [Specific, verifiable criterion — e.g. "All interactive elements have visible focus indicators"]
- [ ] [Another criterion]
```

**Severity → Priority Mapping:**
- CRITICAL → 1 (Urgent)
- HIGH → 2 (High)
- MEDIUM → 3 (Medium)
- LOW → 4 (Low)

**Label Mapping:**

| Domain | Linear Label |
|--------|-------------|
| Accessibility issues, semantic HTML, ARIA | Bug |
| Visual design, UX, responsive layout | Improvement |
| Performance, Core Web Vitals, bundle | Performance |
| Convention (CLAUDE.md compliance) | Convention |

**Rules:**
- Include file paths with line numbers in Context
- Acceptance criteria define "done" — verifiable conditions
- One issue per distinct finding

## Shutdown Team

After all Linear issues are created:
1. Send shutdown requests to all 3 reviewers using `SendMessage` with `type: "shutdown_request"`
2. Wait for shutdown confirmations
3. Use `TeamDelete` to remove team resources

## Fallback: Single-Agent Mode

If `TeamCreate` fails, perform the review as a single agent:

1. **Inform user:** "Agent teams unavailable. Running frontend review in single-agent mode."
2. Read each frontend file in the review scope
3. Apply all domain checks sequentially using [references/frontend-checklist.md](references/frontend-checklist.md):
   a. Accessibility & semantics checks
   b. Visual design & UX checks
   c. Performance & optimization checks
4. Merge, deduplicate, and create Linear issues — same process as team mode

## Error Handling

| Situation | Action |
|-----------|--------|
| Linear MCP not connected | STOP — tell user to run `/mcp` |
| No frontend files found | Stop — "No frontend files found in scope." |
| CLAUDE.md doesn't exist | Use general best practices |
| TeamCreate fails | Switch to single-agent fallback mode |
| Reviewer stops without reporting | Send follow-up message, note domain as incomplete |
| Focus area doesn't match any files | Stop — "No files match the specified area." |

## Rules

- **Analysis only** — Do NOT modify any source code
- **Be specific** — Include file paths and line numbers for every finding
- **Include remediation** — Every finding must have a concrete fix suggestion
- **Prioritize impact** — Focus on issues that affect real users
- **Test don't assume** — Read the actual code, don't guess about implementations
- **Lead handles all Linear writes** — Reviewers NEVER create issues directly
- **Deduplicate before creating** — No duplicate issues in Linear

## Termination

Output this report and STOP:

```
## Frontend Review Report

**Team:** 3 reviewers (accessibility, visual-design, performance)
[OR: **Mode:** single-agent (team unavailable)]
**Scope:** [all frontend files | specific area]
**Files reviewed:** N

### Issues (ordered by priority)

| # | ID | Priority | Label | Title |
|---|-----|----------|-------|-------|
| 1 | FOO-N1 | High | Bug | Brief title |
| 2 | FOO-N2 | Medium | Improvement | Brief title |
| ... | ... | ... | ... | ... |

X issues total | Duplicates merged: M

Next step: Review Backlog in Linear and use `plan-backlog` to create implementation plans.
```

Do not ask follow-up questions. Do not offer to fix issues.
