---
name: frontend-review
description: Reviews all frontend elements (UI, UX, accessibility, visual design, responsiveness, performance) using an agent team with 3 domain-specialized reviewers. Use when user says "review frontend", "check UI", "review UX", "audit accessibility", "check responsive", or "review screens". Falls back to single-agent mode if agent teams unavailable.
argument-hint: [optional: specific area like "settings page" or "photo capture"]
allowed-tools: Read, Glob, Grep, Task, Bash, TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet
disable-model-invocation: true
---

Review all frontend elements using an agent team with domain-specialized reviewers. You are the **team lead/coordinator**. You orchestrate 3 reviewer teammates who examine the frontend through different lenses in parallel, then you merge findings and produce a prioritized report.

**If agent teams are unavailable** (TeamCreate fails), fall back to single-agent mode — see "Fallback: Single-Agent Mode" section.

**Reference:** See [references/frontend-checklist.md](references/frontend-checklist.md) for the comprehensive checklist and [references/reviewer-prompts.md](references/reviewer-prompts.md) for domain-specific reviewer instructions.

## Pre-flight

1. **Read CLAUDE.md** — Load project standards, tech stack, and conventions
2. **Discover frontend files** — Use Glob to find all frontend-related files:
   - `src/app/**/page.tsx` — Pages
   - `src/app/**/layout.tsx` — Layouts
   - `src/components/**/*.tsx` — Components
   - `src/hooks/**/*.ts` — Custom hooks
   - `src/app/globals.css` — Styles
   - `public/manifest.json` — PWA manifest
   - `middleware.ts` — Middleware
3. **Determine review scope:**
   - If `$ARGUMENTS` specifies an area → scope files to that area only
   - If no arguments → review all frontend files
4. **Build the file list** — Create the exact list of files each reviewer will examine

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

Use the `Task` tool with `team_name: "frontend-review"` and `subagent_type: "general-purpose"` to spawn each reviewer. Spawn all 3 in parallel (3 concurrent Task calls in one message).

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

## Produce Report

Output the consolidated report directly (do NOT write to a file). Use this format:

```
## Frontend Review Report

**Scope:** [all frontend files | specific area]
**Reviewers:** accessibility, visual-design, performance (agent team)
[OR: Mode: single-agent (team unavailable)]
**Files reviewed:** N

### Summary

- CRITICAL: X
- HIGH: Y
- MEDIUM: Z
- LOW: W

### Critical & High Findings

1. [CRITICAL] [ACCESSIBILITY] `src/components/food-analyzer.tsx:45` — Description of issue
   **Impact:** Who is affected and how
   **Fix:** Specific remediation steps

2. [HIGH] [VISUAL/UX] `src/app/app/page.tsx:20` — Description of issue
   **Impact:** Who is affected and how
   **Fix:** Specific remediation steps

### Medium Findings

3. [MEDIUM] [PERFORMANCE] `src/components/photo-capture.tsx:100` — Description
   **Fix:** Remediation steps

### Low Findings (Summary)

4. [LOW] [VISUAL] Multiple files — Description (list affected files)

### Checklist Coverage

| Domain | Status | Findings |
|--------|--------|----------|
| Accessibility & Semantics | Complete | X issues |
| Visual Design & UX | Complete | Y issues |
| Performance & Optimization | Complete | Z issues |

### Recommendations

Prioritized list of next steps, grouped by effort level:
- **Quick wins** (< 1 hour each): ...
- **Medium effort**: ...
- **Larger changes**: ...
```

## Shutdown Team

After producing the report:
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
4. Produce the same consolidated report format as team mode

## Error Handling

| Situation | Action |
|-----------|--------|
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
- **Lead handles all output** — Reviewers report to lead, lead produces final report
- **No Linear integration** — This skill outputs a report only, does not create issues
