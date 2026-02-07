# Agent Teams Reference

## Overview

Agent teams coordinate multiple Claude Code instances working together. One session acts as **team lead**, spawning **teammates** that work independently in their own context windows and communicate via messaging.

**Experimental feature** — Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json or environment.

```json
// settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## When to Use Agent Teams vs Subagents

| | Subagents | Agent Teams |
|---|---|---|
| **Context** | Own window; results return to caller | Own window; fully independent |
| **Communication** | Report results back to main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list with self-coordination |
| **Best for** | Focused tasks where only the result matters | Complex work requiring discussion and collaboration |
| **Token cost** | Lower: results summarized back | Higher: each teammate is a separate instance |
| **MCP access** | No | No (teammates don't inherit MCP tools) |

**Use subagents** for quick focused workers that report back. **Use agent teams** when teammates need to share findings, challenge each other, and coordinate.

## Architecture

| Component | Role |
|-----------|------|
| **Team lead** | Main session that creates the team, spawns teammates, coordinates work |
| **Teammates** | Separate Claude Code instances working on assigned tasks |
| **Task list** | Shared work items that teammates claim and complete |
| **Mailbox** | Messaging system for inter-agent communication |

Storage:
- Team config: `~/.claude/teams/{team-name}/config.json`
- Task list: `~/.claude/tasks/{team-name}/`

## Core Tools

### TeamCreate
Creates a team and its shared task list.
```
TeamCreate:
  team_name: "my-team"
  description: "What the team is doing"
```

### TeamDelete
Removes team and task directories. **Fails if teammates are still active** — shut them down first. Only the lead should run cleanup.

### TaskCreate / TaskUpdate / TaskList / TaskGet
Shared task management. Tasks have states: `pending` → `in_progress` → `completed`.
- Tasks can have dependencies (`blockedBy` / `blocks`)
- Task claiming uses file locking to prevent race conditions
- Dependencies auto-unblock when blocking tasks complete

### SendMessage
Inter-agent communication:
- `type: "message"` — DM to one teammate (use this by default)
- `type: "broadcast"` — Send to ALL teammates (expensive, use sparingly)
- `type: "shutdown_request"` — Ask teammate to gracefully shut down
- `type: "shutdown_response"` — Teammate approves/rejects shutdown
- `type: "plan_approval_response"` — Approve/reject teammate's plan

### Spawning Teammates
Use `Task` tool with `team_name` and `name` parameters:
```
Task:
  team_name: "my-team"
  name: "security-reviewer"
  subagent_type: "general-purpose"
  prompt: "Detailed instructions for this teammate..."
```

## Task Sizing Guide

| Size | Problem | Example |
|------|---------|---------|
| Too small | Coordination overhead > benefit | "Rename a variable" |
| Too large | Teammates work too long without check-ins | "Refactor the entire auth system" |
| Just right | Self-contained, clear deliverable | "Review auth module for security issues" |

**Aim for 5-6 tasks per teammate** to keep everyone productive and allow reassignment if someone gets stuck.

## Best Practices

### 1. Partition Work by File Ownership

**Never assign the same file to multiple teammates.** Two teammates editing the same file leads to overwrites. Break work so each teammate owns a distinct set of files.

```
# Good: each worker owns different files
Worker 1: src/auth/login.ts, src/auth/session.ts
Worker 2: src/api/users.ts, src/api/settings.ts
Worker 3: src/components/LoginForm.tsx, src/components/Settings.tsx

# Bad: overlapping file ownership
Worker 1: src/auth/ (all files)
Worker 2: src/auth/login.ts, src/api/users.ts  # CONFLICT on login.ts
```

### 2. Give Teammates Enough Context

Teammates load CLAUDE.md and project skills automatically but do NOT inherit the lead's conversation history. Include everything task-specific in the spawn prompt:
- Specific files to work on
- Acceptance criteria
- Project conventions relevant to their task
- Existing issues or constraints

### 3. Lead Handles All External Writes

Teammates do NOT have MCP tool access. Any operations requiring MCP (Linear issues, Railway deploys, etc.) must be done by the lead. Teammates report findings via `SendMessage`, and the lead acts on them.

### 4. Use Domain Specialization

Specialized teammates outperform generalists. Assign distinct domains:
```
# Good: clear domain boundaries
- security-reviewer: OWASP checks, auth, injection, secrets
- reliability-reviewer: async issues, resource leaks, error handling
- quality-reviewer: type safety, conventions, dead code

# Bad: vague overlapping roles
- reviewer-1: "review the code"
- reviewer-2: "also review the code"
```

### 5. Structured Reporting Format

Define a clear format for teammate findings so the lead can merge and deduplicate:
```
DOMAIN: Security
FINDINGS:
1. [security] [high] src/auth/login.ts:42 - No rate limiting on login endpoint
2. [security] [medium] src/api/users.ts:15 - Missing input validation
```

### 6. Handle Idle Notifications Correctly

Teammates go idle after every turn — this is **normal**, not an error. An idle notification does NOT mean they're done. They're done when they send their findings message or mark their task as completed.

### 7. Monitor and Steer

Check in on progress, redirect approaches that aren't working, and synthesize findings as they come in. Unattended teams risk wasted effort.

### 8. Use Delegate Mode for Pure Orchestration

Press `Shift+Tab` to enter delegate mode, which restricts the lead to coordination-only tools. Prevents the lead from implementing tasks itself instead of delegating.

## Quality Gates with Hooks

### TeammateIdle (v2.1.33+)
Runs when a teammate is about to go idle. Exit code 2 sends feedback and keeps them working.

### TaskCompleted (v2.1.33+)
Runs when a task is being marked complete. Exit code 2 prevents completion and sends feedback.

Example: enforce test coverage before task completion:
```json
// settings.json
{
  "hooks": {
    "TaskCompleted": [
      {
        "type": "command",
        "command": "./scripts/check-test-coverage.sh"
      }
    ]
  }
}
```

## Patterns

### Parallel Code Review (3 specialized reviewers)
```
Lead spawns 3 teammates:
1. security-reviewer — OWASP, auth, injection
2. reliability-reviewer — async, resources, error handling
3. quality-reviewer — types, conventions, dead code

Each reads all source files through their domain lens.
Lead merges findings, deduplicates, creates issues.
```

### Competing Hypothesis Investigation
```
Lead spawns N teammates, each investigating a different theory:
- Teammate A: "The bug is in the auth middleware"
- Teammate B: "The bug is in the session handling"
- Teammate C: "The bug is a race condition in the API"

Teammates can message each other to challenge findings.
Lead synthesizes the winning theory.
```

### Parallel Feature Implementation
```
Lead partitions work by file ownership:
- Worker 1: backend API routes (src/api/)
- Worker 2: frontend components (src/components/)
- Worker 3: tests (src/__tests__/)

Each worker owns distinct files. No overlaps.
Lead handles integration and CLI-generated files.
```

## Skill That Orchestrates a Team

When a skill needs to orchestrate an agent team, include team tools in `allowed-tools`:

```yaml
---
name: my-team-skill
allowed-tools: Read, Glob, Grep, Task, Bash, TeamCreate, TeamDelete,
  SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet
disable-model-invocation: true
---
```

**Skill structure for team orchestration:**
1. Pre-flight checks (verify dependencies like MCP connections)
2. TeamCreate with descriptive name
3. TaskCreate for each work unit
4. Spawn teammates via Task tool with `team_name` and `name`
5. Assign tasks via TaskUpdate
6. Wait for teammate messages (auto-delivered)
7. Merge/synthesize findings
8. Act on results (create issues, apply fixes, etc.)
9. Shutdown teammates via SendMessage `shutdown_request`
10. TeamDelete to clean up

**Fallback pattern:** Always include a single-agent fallback if `TeamCreate` fails:
```
1. Try TeamCreate
2. If fails → inform user "Agent teams unavailable, running in single-agent mode"
3. Use sequential Task tool subagents instead (without team_name)
```

## Lessons from Production Use

These insights come from real-world agent team deployments:

### Environment Design Matters Most
- **Test quality is paramount** — agents solve whatever the tests define, so tests must be nearly perfect
- **Don't pollute stdout** — log to files, use grep-friendly formats (`ERROR: reason` on one line)
- **Pre-compute summaries** — avoid agents recomputing expensive metrics repeatedly
- **Use deterministic sampling** — for large test suites, give agents `--fast` options that run 1-10% subsets

### Decomposition Is the Hard Problem
- **Monolithic tasks defeat parallelism** — N agents on one giant task ≈ 1 agent's effectiveness
- **Oracle-based decomposition** — when possible, use a reference implementation to break work into independent subtasks
- **Independent test cases** — each agent gets a different failing test to fix

### Coordination Overhead Is Real
- Teams use significantly more tokens than single sessions
- Start with research/review tasks before attempting parallel implementation
- For sequential work or same-file edits, a single session is more effective
- Cap at ~4 teammates for most tasks — diminishing returns beyond that

### Workers Must Not Hand-Write Generated Files
If a task involves running a CLI generator (migrations, codegen, etc.), reserve that for the lead's post-implementation phase. Workers that hand-write generated files produce corrupt output.

## Limitations

- **No session resumption** for in-process teammates (`/resume` doesn't restore them)
- **Task status can lag** — teammates sometimes fail to mark tasks completed
- **One team per session** — clean up before starting a new team
- **No nested teams** — teammates cannot spawn their own teams
- **Lead is fixed** — can't promote a teammate to lead
- **Permissions set at spawn** — all teammates start with lead's permission mode
- **No MCP access** for teammates
- **Split panes** require tmux or iTerm2 (not VS Code terminal, Windows Terminal, or Ghostty)
